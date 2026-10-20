import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Server } from 'node:http';
import app from '../index';
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { createAccount, deleteAccountById } from '../db/queries/accounts';
import { createUser, deleteUserById } from '../db/queries/users';
import { getSubplanByName } from '../db/queries/subplans';
import { getPlanByName } from '../db/queries/plans';
import { once } from "node:events";

describe("Usage Metering Service", () => {
    let server: Server;
    let baseUrl: string;
    let accountPlans: Awaited<ReturnType<typeof getPlanByName>> | undefined;
    let accountStarterSubplan: Awaited<ReturnType<typeof getSubplanByName>> | undefined;
    let accountProSubplan: Awaited<ReturnType<typeof getSubplanByName>> | undefined;
    let testAccount: Awaited<ReturnType<typeof createAccount>> | undefined;
    let testAccount2: Awaited<ReturnType<typeof createAccount>> | undefined;
    let userPlans: Awaited<ReturnType<typeof getPlanByName>> | undefined;
    let userBasicSubplan: Awaited<ReturnType<typeof getSubplanByName>> | undefined;
    let userPremiumSubplan: Awaited<ReturnType<typeof getSubplanByName>> | undefined;
    let testUser: Awaited<ReturnType<typeof createUser>> | undefined;
    let testUser2: Awaited<ReturnType<typeof createUser>> | undefined;
    let apiKey: string;
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
        accountStarterSubplan = await getSubplanByName(accountPlans.id, "Starter");
        if (accountStarterSubplan === undefined) {
            throw new Error("Starter subplan not found");
        }
        apiKey = randomBytes(32).toString('hex');
        testAccount = await createAccount({
            name: `Test Account ${randomBytes(4).toString('hex')}`,
            hashed_api_key: createHash("sha256").update(apiKey).digest("hex"),
            subplan_id: accountStarterSubplan.id,
        });
        if (testAccount === undefined) {
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
        testUser = await createUser({
            email: `testuser1_${randomBytes(4).toString('hex')}@example.com`,
            account_id: testAccount.id,
            subplan_id: userBasicSubplan.id,
        });
        if (testUser === undefined) {
            throw new Error("Failed to create test user");
        }

        accountProSubplan = await getSubplanByName(accountPlans.id, "Pro");
        if (accountProSubplan === undefined) {
            throw new Error("Pro subplan not found");
        }
        apiKey2 = randomBytes(32).toString('hex');
        testAccount2 = await createAccount({
            name: `Test Account 2 ${randomBytes(4).toString('hex')}`,
            hashed_api_key: createHash("sha256").update(apiKey2).digest("hex"),
            subplan_id: accountProSubplan.id,
        });
        if (testAccount2 === undefined) {
            throw new Error("Failed to create test accounts");
        }
        userPremiumSubplan = await getSubplanByName(userPlans.id, "Premium");
        if (userPremiumSubplan === undefined) {
            throw new Error("Premium subplan not found");
        }
        testUser2 = await createUser({
            email: `testuser2_${randomBytes(4).toString('hex')}@example.com`,
            account_id: testAccount2.id,
            subplan_id: userPremiumSubplan.id,
        });
        if (testUser2 === undefined) {
            throw new Error("Failed to create test user");
        }
    });

    it('should accept 1 request out of 10 concurrent requests within the rate limit', async () => {
        if (testUser === undefined) {
            throw new Error("Test user not found");
        }
        for (const units of [...Array(9).fill(10), 9]) {
            const response = await fetch(`${baseUrl}/usage/consume`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                },
                body: JSON.stringify({
                    userId: testUser.id,
                    requestId: randomUUID(),
                    units,
                }),
            });

            expect(response.status).toBe(200);
        }
        const startTime = performance.now();
        const requestsTimersInMs: number[] = [];
        const requests = Array.from({ length: 10 }, async ()=> {
            const start = performance.now();
            const response = await fetch(`${baseUrl}/usage/consume`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey
                },
                body: JSON.stringify({
                    userId: testUser!.id,
                    requestId: randomUUID(),
                    units: 1
                }),
            });
            const end = performance.now();
            requestsTimersInMs.push(end - start);
            return response;
        });
        const responses = await Promise.all(requests);
        const endTime = performance.now();
        const durationMs = endTime - startTime;
        const averageTimeMs = requestsTimersInMs.reduce((a, b) => a + b, 0) / requestsTimersInMs.length;
        console.log(`Total duration for 10 concurrent requests: ${durationMs.toFixed(2)} ms`);
        console.log(`Average time per request: ${averageTimeMs.toFixed(2)} ms`);
        const RPS = 10 / (durationMs / 1000);
        console.log(`Requests per second (RPS): ${RPS.toFixed(2)}`);
        const sortedTimers = [...requestsTimersInMs].sort((a, b) => a - b);
        const p95 = sortedTimers[Math.ceil(0.95 * sortedTimers.length) - 1];
        if (p95 === undefined){
            throw new Error("Failed to calculate 95th percentile response time");
        }
        console.log(`95th percentile response time: ${p95.toFixed(2)} ms`);

        const successCount = responses.filter(response => response.status === 200).length;
        const rejectedCount = responses.filter(response => response.status === 403).length;

        expect(successCount).toBe(1);
        expect(rejectedCount).toBe(9);

        const summaryResponse = await fetch(`${baseUrl}/usage/summary?userId=${testUser.id}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
            },
        });
        expect(summaryResponse.status).toBe(200);
        const summary = await summaryResponse.json();
        expect(summary.account.used).toBe(100);
        expect(summary.user.used).toBe(100);
    });

    it('should handle 100 concurrent successful usage requests and report performance metrics', async () => {
        if (testUser2 === undefined) {
            throw new Error("Test user 2 not found");
        }
        const startTime = performance.now();
        const requestsTimersInMs: number[] = [];
        const requests = Array.from({ length: 100 }, async () => {
            const start = performance.now();
            const response = await fetch(`${baseUrl}/usage/consume`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey2
                },
                body: JSON.stringify({
                    userId: testUser2!.id,
                    requestId: randomUUID(),
                    units: 1
                }),
            });
            const end = performance.now();
            requestsTimersInMs.push(end - start);
            return response;
        });
        const responses = await Promise.all(requests);
        const endTime = performance.now();
        const durationMs = endTime - startTime;
        const averageTimeMs = requestsTimersInMs.reduce((a, b) => a + b, 0) / requestsTimersInMs.length;
        console.log(`Total duration for 100 concurrent requests: ${durationMs.toFixed(2)} ms`);
        console.log(`Average time per request: ${averageTimeMs.toFixed(2)} ms`);
        const RPS = 100 / (durationMs / 1000);
        console.log(`Requests per second (RPS): ${RPS.toFixed(2)}`);
        const sortedTimers = [...requestsTimersInMs].sort((a, b) => a - b);
        const p95 = sortedTimers[Math.ceil(0.95 * sortedTimers.length) - 1];
        if (p95 === undefined){
            throw new Error("Failed to calculate 95th percentile response time");
        }
        console.log(`95th percentile response time for 100 concurrent requests: ${p95.toFixed(2)} ms`);

        const successCount = responses.filter(response => response.status === 200).length;
        const rejectedCount = responses.filter(response => response.status === 403).length;
        expect(successCount).toBe(100);
        expect(rejectedCount).toBe(0);

        const summaryResponse = await fetch(`${baseUrl}/usage/summary?userId=${testUser2.id}`, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey2,
            },
        });
        expect(summaryResponse.status).toBe(200);
        const summary = await summaryResponse.json();
        expect(summary.account.used).toBe(100);
        expect(summary.user.used).toBe(100);
    });

    afterAll(async () => {
        try {
            // Clean up test data after tests are done
            if (testUser && testAccount) {
                await deleteUserById(testUser.id, testAccount.id);
            }
            if (testAccount) {
                await deleteAccountById(testAccount.id);
            }
            if (testUser2 && testAccount2) {
                await deleteUserById(testUser2.id, testAccount2.id);
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