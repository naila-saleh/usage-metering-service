import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { consumeUsage } from "./usage-service";
import { getUsageByRequestId, createUsage, setUsageSuccess, deleteUsageHistoryByAccountId, getAccountUsageHistory } from "../db/queries/usages";
import { createAccount, deleteAccountById } from "../db/queries/accounts";
import { createUser, deleteUserById } from "../db/queries/users";
import { getPlanByName } from "../db/queries/plans";
import { getSubplanByName } from "../db/queries/subplans";


describe('consumeUsage Integration Tests', () => {
    let account: Awaited<ReturnType<typeof createAccount>> | undefined;
    let user: Awaited<ReturnType<typeof createUser>> | undefined;
    let premiumUser: Awaited<ReturnType<typeof createUser>> | undefined;
    let requestId: string;
    let premiumRequestId: string;
    beforeEach(async () => {
        const accountPlan = await getPlanByName('Account Plans');
        const userPlan = await getPlanByName('User Plans');
        const accountSubplan = await getSubplanByName(accountPlan!.id,'Pro');
        const userSubplan = await getSubplanByName(userPlan!.id, 'Basic');
        requestId = randomUUID();
        const uniqueId = randomUUID();
        account = await createAccount({
            name: `Test Account ${uniqueId}`,
            is_active: true,
            hashed_api_key: `hashed_${uniqueId}`,
            subplan_id: accountSubplan!.id,
            subscription_started_at: new Date(),
        });
        user = await createUser({
            email: `test-${uniqueId}@example.com`,
            is_active: true,
            is_admin: false,
            account_id: account!.id,
            subplan_id: userSubplan!.id,
            subscription_started_at: new Date(),
        });
        const premiumUserSubplan = await getSubplanByName(userPlan!.id, 'Premium');
        premiumRequestId = randomUUID();
        premiumUser = await createUser({
            email: `premium-${uniqueId}@example.com`,
            is_active: true,
            is_admin: false,
            account_id: account!.id,
            subplan_id: premiumUserSubplan!.id,
            subscription_started_at: new Date(),
        });
    });

    it ('persists a successful usage in PostgreSQL', async () => {
        const units = 2;
        await consumeUsage(account!.id, user!.id, requestId, units);
        const result = await getUsageByRequestId(requestId, account!.id);
        expect(result).toBeDefined();
        expect(result).toMatchObject({
            request_id: requestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: units,
            is_success: true,
        });
    });

    it ('persists a rejected usage in PostgreSQL when user exceeds max_request_limit', async () => {
        const units = 11; // user max_request_limit is 10
        await expect(
            consumeUsage(account!.id, user!.id, requestId, units)
        ).rejects.toThrow("exceeds the maximum request limit for user");
        const result = await getUsageByRequestId(requestId, account!.id);
        expect(result).toBeDefined();
        expect(result).toMatchObject({
            request_id: requestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: units,
            is_success: false,
            rejected_by: "user",
            rejected_reason: "User max request limit exceeded",
        });
    });

    it( 'persists a rejected usage in PostgreSQL when account exceeds max_request_limit', async () => {
        const units = 101; // account max_request_limit is 100
        await expect(
            consumeUsage(account!.id, premiumUser!.id, premiumRequestId, units)
        ).rejects.toThrow("exceeds the maximum request limit for account");
        const result = await getUsageByRequestId(premiumRequestId, account!.id);
        expect(result).toBeDefined();
        expect(result).toMatchObject({
            request_id: premiumRequestId,
            account_id: account!.id,
            user_id: premiumUser!.id,
            amount: units,
            is_success: false,
            rejected_by: "account",
            rejected_reason: "Account max request limit exceeded",
        });
    });

    it('persists a rejected usage in PostgreSQL when user exceeds monthly_limit', async () => {
        for (const units of [...Array(9).fill(10), 9]) {
            const requestId = randomUUID();
            await consumeUsage(account!.id, user!.id, requestId, units);
            await setUsageSuccess(requestId, account!.id);
        }
        const units = 2; // user monthly_limit is 100, already used 99
        const newRequestId = randomUUID();
        await expect(
            consumeUsage(account!.id, user!.id, newRequestId, units)
        ).rejects.toThrow("has exceeded its monthly limit");
        const result = await getUsageByRequestId(newRequestId, account!.id);
        expect(result).toBeDefined();
        expect(result).toMatchObject({
            request_id: newRequestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: units,
            is_success: false,
            rejected_by: "user",
            rejected_reason: "User monthly limit exceeded",
        });
    });

    it ('persists a rejected usage in PostgreSQL when account exceeds monthly_limit', async () => {
        const units = 999; // account monthly_limit is 1000
        let usage = await createUsage({
            request_id: randomUUID(),
            account_id: account!.id,
            user_id: user!.id,
            amount: units, // 999 units already used
        });
        await setUsageSuccess(usage!.request_id, account!.id);
        await expect(
            consumeUsage(account!.id, user!.id, requestId, 2) // trying to use 2 more units
        ).rejects.toThrow("has exceeded its monthly limit");
        const result = await getUsageByRequestId(requestId, account!.id);
        expect(result).toBeDefined();
        expect(result).toMatchObject({
            request_id: requestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: 2,
            is_success: false,
            rejected_by: "account",
            rejected_reason: "Account monthly limit exceeded",
        });
    });

    it ('retrying a previously rejected usage with the same requestId does not create a new usage entry', async () => {
        const units = 11; // user max_request_limit is 10
        await expect(
            consumeUsage(account!.id, user!.id, requestId, units)
        ).rejects.toThrow("exceeds the maximum request limit for user");
        const result1 = await getUsageByRequestId(requestId, account!.id);
        expect(result1).toBeDefined();
        expect(result1).toMatchObject({
            request_id: requestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: units,
            is_success: false,
            rejected_by: "user",
            rejected_reason: "User max request limit exceeded",
        });

        // Retry with the same requestId
        await expect(
            consumeUsage(account!.id, user!.id, requestId, units)
        ).rejects.toThrow("User max request limit exceeded")
        const result2 = await getUsageByRequestId(requestId, account!.id);
        expect(result2).toBeDefined();
        expect(result2).toMatchObject({
            request_id: requestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: units,
            is_success: false,
            rejected_by: "user",
            rejected_reason: "User max request limit exceeded",
        });

        const usageHistory = await getAccountUsageHistory(account!.id, 10, 1);
        const usageEntriesWithRequestId = usageHistory.filter(entry => entry.request_id === requestId);
        expect(usageEntriesWithRequestId.length).toBe(1); // Only one entry should exist for the same requestId
    });

    it ('retrying a previously successful usage with the same requestId does not create a new usage entry', async () => {
        const units = 2;
        await consumeUsage(account!.id, user!.id, requestId, units);
        const result1 = await getUsageByRequestId(requestId, account!.id);
        expect(result1).toBeDefined();
        expect(result1).toMatchObject({
            request_id: requestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: units,
            is_success: true,
        });

        // Retry with the same requestId
        await consumeUsage(account!.id, user!.id, requestId, units);
        const result2 = await getUsageByRequestId(requestId, account!.id);
        expect(result2).toBeDefined();
        expect(result2).toMatchObject({
            request_id: requestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: units,
            is_success: true,
        });

        const usageHistory = await getAccountUsageHistory(account!.id, 10, 1);
        const usageEntriesWithRequestId = usageHistory.filter(entry => entry.request_id === requestId);
        expect(usageEntriesWithRequestId.length).toBe(1); // Only one entry should exist for the same requestId
    });

    it ('retrying a previously rejected usage with the same requestId but different amount does not create a new usage entry', async () => {
        const units = 11; // user max_request_limit is 10
        await expect(
            consumeUsage(account!.id, user!.id, requestId, units)
        ).rejects.toThrow("exceeds the maximum request limit for user");
        const result1 = await getUsageByRequestId(requestId, account!.id);
        expect(result1).toBeDefined();
        expect(result1).toMatchObject({
            request_id: requestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: units,
            is_success: false,
            rejected_by: "user",
            rejected_reason: "User max request limit exceeded",
        });

        // Retry with the same requestId but different amount
        const newUnits = 2;
        await expect(
            consumeUsage(account!.id, user!.id, requestId, newUnits)
        ).rejects.toThrow(`Request with ID ${requestId} has already been processed with a different amount: ${units}`);
        const result2 = await getUsageByRequestId(requestId, account!.id);
        expect(result2).toBeDefined();
        expect(result2).toMatchObject({
            request_id: requestId,
            account_id: account!.id,
            user_id: user!.id,
            amount: units, // The original amount should still be present
            is_success: false,
            rejected_by: "user",
            rejected_reason: "User max request limit exceeded",
        });

        const usageHistory = await getAccountUsageHistory(account!.id, 10, 1);
        const usageEntriesWithRequestId = usageHistory.filter(entry => entry.request_id === requestId);
        expect(usageEntriesWithRequestId.length).toBe(1); // Only one entry should exist for the same requestId
    });

    afterEach(async () => {
        // Clean up the created usage, account and user
        if (account) {
            await deleteUsageHistoryByAccountId(account.id);
        }
        if (user && account) {
            await deleteUserById(user.id, account.id);
        }
        if (account) {
            await deleteAccountById(account.id);
        }
    });
});