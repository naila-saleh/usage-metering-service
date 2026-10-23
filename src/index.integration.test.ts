import {describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Server } from 'node:http';
import app from './index';
import {randomBytes, createHash, randomUUID} from "node:crypto";
import { createAccount, deleteAccountById } from './db/queries/accounts';
import { createUser, deleteUserById } from './db/queries/users';
import { getSubplanByName } from './db/queries/subplans';
import { getPlanByName } from './db/queries/plans';
import { once } from "node:events";

describe("Usage Metering Service", () => {
    let server: Server;
    let baseUrl: string;
    let accountPlans: Awaited<ReturnType<typeof getPlanByName>> | undefined;
    let accountProSubplan: Awaited<ReturnType<typeof getSubplanByName>> | undefined;
    let accountStarterSubplan: Awaited<ReturnType<typeof getSubplanByName>> | undefined;
    let testAccount1: Awaited<ReturnType<typeof createAccount>> | undefined;
    let testAccount2: Awaited<ReturnType<typeof createAccount>> | undefined;
    let userPlans: Awaited<ReturnType<typeof getPlanByName>> | undefined;
    let userBasicSubplan: Awaited<ReturnType<typeof getSubplanByName>> | undefined;
    let userPremiumSubplan: Awaited<ReturnType<typeof getSubplanByName>> | undefined;
    let testUser1: Awaited<ReturnType<typeof createUser>> | undefined;
    let testUser2: Awaited<ReturnType<typeof createUser>> | undefined;
    let apiKey1: string;
    let apiKey2: string;
    beforeAll(async () => {
        // Start the server before running tests
        server = app.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (address && typeof address === 'object') {
            baseUrl = `http://127.0.0.1:${address.port}`;
        }else {
            throw new Error("Failed to get server address");
        }
        accountPlans = await getPlanByName("Account Plans");
        if (accountPlans === undefined) {
            throw new Error("Account Plans plan not found");
        }
        accountProSubplan = await getSubplanByName(accountPlans.id, "Pro");
        if (accountProSubplan === undefined) {
            throw new Error("Pro subplan not found");
        }
        accountStarterSubplan = await getSubplanByName(accountPlans.id, "Starter");
        if (accountStarterSubplan === undefined) {
            throw new Error("Starter subplan not found");
        }
        apiKey1 = randomBytes(32).toString('hex');
        testAccount1 = await createAccount({
            name: `Test Account ${randomBytes(4).toString('hex')}`,
            hashed_api_key: createHash("sha256").update(apiKey1).digest("hex"),
            subplan_id: accountProSubplan.id,
        });
        apiKey2 = randomBytes(32).toString('hex');
        testAccount2 = await createAccount({
            name: `Test Account ${randomBytes(4).toString('hex')}`,
            hashed_api_key: createHash("sha256").update(apiKey2).digest("hex"),
            subplan_id: accountStarterSubplan.id,
        });
        if (testAccount1 === undefined || testAccount2 === undefined) {
            throw new Error("Failed to create test accounts");
        }
        userPlans = await getPlanByName("User Plans");
        if (userPlans === undefined) {
            throw new Error("User Plans plan not found");
        }
        userBasicSubplan = await getSubplanByName(userPlans.id, "Basic");
        if (userBasicSubplan === undefined) {
            throw new Error("Basic subplan not found");
        }
        testUser1 = await createUser({
            email: `testuser1_${randomBytes(4).toString('hex')}@example.com`,
            account_id: testAccount1.id,
            subplan_id: userBasicSubplan.id,
        });
        if (testUser1 === undefined) {
            throw new Error("Failed to create test user");
        }
        userPremiumSubplan = await getSubplanByName(userPlans.id, "Premium");
        if (userPremiumSubplan === undefined) {
            throw new Error("Premium subplan not found");
        }
        testUser2 = await createUser({
            email: `testuser2_${randomBytes(4).toString('hex')}@example.com`,
            account_id: testAccount1.id,
            subplan_id: userPremiumSubplan.id,
        });
        if (testUser2 === undefined) {
            throw new Error("Failed to create test user 2");
        }
    });

    it('should reject requests with invalid API keys', async () => {
        const response = await fetch(`${baseUrl}/accounts/me`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'invalid-api-key',
            },
        });
        expect(response.status).toBe(401);
    });

    it('should reject requests with missing API keys', async () => {
        const response = await fetch(`${baseUrl}/accounts/me`, {
            headers: {
                'Content-Type': 'application/json',
            },
        });
        expect(response.status).toBe(401);
    });

    it('should deny account 2 access to account 1 user\'s summary', async () => {
        if ( testUser1 === undefined) {
            throw new Error("Test user is not defined");
        }
        const usageSummary = await fetch(`${baseUrl}/usage/summary?userId=${testUser1.id}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey2,
            },
        });
        expect(usageSummary.status).toBe(404);
    });

    it('should deny account 2 access to account 1 user\'s history', async () => {
        if (testUser1 === undefined) {
            throw new Error("Test user is not defined");
        }
        const usageHistory = await fetch(`${baseUrl}/usage/history?userId=${testUser1.id}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey2,
            },
        });
        expect(usageHistory.status).toBe(404);
    });

    it('should return 409 when retrying a request with a different amount.', async () => {
        if (testUser1 === undefined) {
            throw new Error("Test user is not defined");
        }
        const requestId = randomUUID();
        const usageAmount = 2;
        const usageResponse1 = await fetch(`${baseUrl}/usage/consume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
            body: JSON.stringify({
                userId: testUser1.id,
                units: usageAmount,
                requestId: requestId,
            }),
        });
        expect(usageResponse1.status).toBe(200);

        const usageResponse2 = await fetch(`${baseUrl}/usage/consume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
            body: JSON.stringify({
                userId: testUser1.id,
                units: usageAmount + 1, // Different amount
                requestId: requestId, // Same requestId
            }),
        });
        expect(usageResponse2.status).toBe(409); // Expecting conflict due to different amount with same requestId
    });

    it('should return 409 when retrying a request with the same request ID but from different users.', async () => {
        if (testUser1 === undefined || testUser2 === undefined) {
            throw new Error("Test users are not defined");
        }
        const requestId = randomUUID();
        const usageAmount = 2;
        const usageResponse1 = await fetch(`${baseUrl}/usage/consume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
            body: JSON.stringify({
                userId: testUser1.id,
                units: usageAmount,
                requestId: requestId,
            }),
        });
        expect(usageResponse1.status).toBe(200);

        const usageResponse2 = await fetch(`${baseUrl}/usage/consume`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
            body: JSON.stringify({
                userId: testUser2.id, // Different user
                units: usageAmount, // Same amount
                requestId: requestId, // Same requestId
            }),
        });
        expect(usageResponse2.status).toBe(409); // Expecting conflict due to same requestId but different user
    });

    it('should return the right usage consume summary for the current month.', async () => {
        if (testUser1 === undefined) {
            throw new Error("Test user is not defined");
        }
        const summary = await fetch(`${baseUrl}/usage/summary?userId=${testUser1.id}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
        });
        expect(summary.status).toBe(200);
        const summaryData = await summary.json();
        expect(summaryData).toMatchObject({
            account: expect.objectContaining({
                monthlyLimit: expect.any(Number),
                used: expect.any(Number),
                remaining: expect.any(Number),
            }),
            user: expect.objectContaining({
                monthlyLimit: expect.any(Number),
                used: expect.any(Number),
                remaining: expect.any(Number),
            }),
        });
    });

    it('should return the right usage consume summary for a previous month.', async () => {
        if (testUser1 === undefined) {
            throw new Error("Test user is not defined");
        }
        // Format: YYYY-MM (last month from current year)
        const now = new Date();
        const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const month = previous.toISOString().slice(0, 7);
        const summary = await fetch(`${baseUrl}/usage/summary?userId=${testUser1.id}&monthAndYear=${month}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
        });
        expect(summary.status).toBe(200);
        const summaryData = await summary.json();
        expect(summaryData).toMatchObject({
            account: expect.objectContaining({
                monthlyLimit: expect.any(Number),
                used: expect.any(Number),
            }),
            user: expect.objectContaining({
                monthlyLimit: expect.any(Number),
                used: expect.any(Number),
            }),
        });
    });

    it('should reject a wrong month format in the usage summary endpoint.', async () => {
        if (testUser1 === undefined) {
            throw new Error("Test user is not defined");
        }
        const invalidMonth = "2023-13";
        const summary = await fetch(`${baseUrl}/usage/summary?userId=${testUser1.id}&monthAndYear=${invalidMonth}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
        });
        expect(summary.status).toBe(400);
    });

    it('should reject a month in the future in the usage summary endpoint.', async () => {
        if (testUser1 === undefined) {
            throw new Error("Test user is not defined");
        }
        const futureMonth = "2028-01";
        const summary = await fetch(`${baseUrl}/usage/summary?userId=${testUser1.id}&monthAndYear=${futureMonth}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
        });
        expect(summary.status).toBe(400);
    });

    it('should return 200 for downgrade account plan under the new limit', async () => {
        if (testAccount1 === undefined) {
            throw new Error("Pro subplan is not defined");
        }
        const downgradeResponse = await fetch(`${baseUrl}/accounts/me/plan`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
            body: JSON.stringify({
                planName: 'Starter',
            }),
        });
        expect(downgradeResponse.status).toBe(200);
    });

    it('should reject a consume request after downgrade if it exceeds the new limit by account', async () => {
        if (testUser2 === undefined) {
            throw new Error("Test user is not defined");
        }
        const upgradeAccount = await fetch(`${baseUrl}/accounts/me/plan`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
            body: JSON.stringify({
                planName: 'Pro',
            }),
        });
        expect(upgradeAccount.status).toBe(200);
        for (const units of [99, 11]) {
            const response = await fetch(`${baseUrl}/usage/consume`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey1,
                },
                body: JSON.stringify({
                    userId: testUser2.id,
                    requestId: randomUUID(),
                    units,
                }),
            });
            expect(response.status).toBe(200);
        }
        const downgradeResponse = await fetch(`${baseUrl}/accounts/me/plan`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
            body: JSON.stringify({
                planName: 'Starter',
            }),
        });
        expect(downgradeResponse.status).toBe(200);
        const consumeResponse = await fetch(`${baseUrl}/usage/consume`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey1,
            },
            body: JSON.stringify({
                userId: testUser2.id,
                requestId: randomUUID(),
                units: 1,
            }),
        });
        expect(consumeResponse.status).toBe(403);
        const summaryResponse = await fetch(`${baseUrl}/usage/summary?userId=${testUser2.id}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey1,
            },
        });
        expect(summaryResponse.status).toBe(200);
        const summaryData = await summaryResponse.json();
        expect(summaryData.account.used).toBeGreaterThanOrEqual(summaryData.account.monthlyLimit);
        expect(summaryData.account.remaining).toBe(0);
    });

    it('should succeed creating a new user plan and assigning it to a user under that account', async () => {
        if (userPlans === undefined || testUser1 === undefined) {
            throw new Error("User Plans or test user is not defined");
        }
        const nameSuffix = randomBytes(4).toString('hex');
        const newPlan = await fetch(`${baseUrl}/plans/${userPlans.id}/subplans`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey1,
            },
            body: JSON.stringify({
                name: `Medium ${nameSuffix}`,
                description: "Medium plan for users",
                price: "29.99",
                monthly_limit: 1000,
                max_request_limit: 20,
            }),
        });
        expect(newPlan.status).toBe(201);
        const updatedUserPlan = await fetch(`${baseUrl}/users/${testUser1.id}/plan`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey1,
            },
            body: JSON.stringify({
                planName: "Medium " + nameSuffix,
            }),
        });
        expect(updatedUserPlan.status).toBe(200);
        expect(await updatedUserPlan.json()).toMatchObject({
            userId: testUser1.id,
            email: testUser1.email,
            planName: "Medium " + nameSuffix,
        });
    });

    it('should change the next consume request limit when updating the custom user plan', async () => {
        if (userPlans === undefined || testUser1 === undefined) {
            throw new Error("User Plans or test user is not defined");
        }
        const nameSuffix = randomBytes(4).toString('hex');
        const newPlan = await fetch(`${baseUrl}/plans/${userPlans.id}/subplans`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey1,
            },
            body: JSON.stringify({
                name: `Medium ${nameSuffix}`,
                description: "Medium plan for users",
                price: "29.99",
                monthly_limit: 1000,
                max_request_limit: 20,
            }),
        });
        expect(newPlan.status).toBe(201);
        const updatedUserPlan = await fetch(`${baseUrl}/users/${testUser1.id}/plan`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey1,
            },
            body: JSON.stringify({
                planName: "Medium " + nameSuffix,
            }),
        });
        expect(updatedUserPlan.status).toBe(200);
        expect(await updatedUserPlan.json()).toMatchObject({
            userId: testUser1.id,
            email: testUser1.email,
            planName: "Medium " + nameSuffix,
        });
        const subplanId = (await newPlan.json()).id;
        const updateCustomPlan = await fetch(`${baseUrl}/plans/${userPlans.id}/subplans/${subplanId}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey1,
            },
            body: JSON.stringify({
                max_request_limit: 5,
            }),
        });
        expect(updateCustomPlan.status).toBe(200);
        const consumeResponse = await fetch(`${baseUrl}/usage/consume`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey1,
            },
            body: JSON.stringify({
                userId: testUser1.id,
                requestId: randomUUID(),
                units: 6, // Exceeding the new limit of 5
            }),
        });
        expect(consumeResponse.status).toBe(403); // Should be forbidden due to exceeding the new limit
    });

    it("an account can't consume usage from another account's user", async () => {
        if (testUser1 === undefined) {
            throw new Error("Test user is not defined");
        }
        const response = await fetch(`${baseUrl}/usage/consume`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey2, // Using API key from account 2
            },
            body: JSON.stringify({
                userId: testUser1.id, // User from account 1
                requestId: randomUUID(),
                units: 1,
            }),
        });
        expect(response.status).toBe(404); // Should return 404 as the user doesn't belong to account 2
    });

    it("should reject updating a system plan", async () => {
        if (userPlans === undefined || userBasicSubplan === undefined) {
            throw new Error("User Plans or Basic subplan is not defined");
        }
        const updateSystemPlan = await fetch(`${baseUrl}/plans/${userPlans.id}/subplans/${userBasicSubplan.id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey1,
            },
            body: JSON.stringify({
                max_request_limit: 50,
            }),
        });
        expect(updateSystemPlan.status).toBe(403); // Should be forbidden as system plans cannot be updated
    });

    afterAll(async () => {
        try {
            // Clean up test data after tests are done
            if (testUser1 && testAccount1) {
                await deleteUserById(testUser1.id, testAccount1.id);
            }
            if (testAccount1) {
                await deleteAccountById(testAccount1.id);
            }
            if (testAccount2) {
                await deleteAccountById(testAccount2.id);
            }
        }
        finally {
            // Close the server after tests
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        }
    });
})