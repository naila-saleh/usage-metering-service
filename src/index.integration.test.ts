import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Server } from 'node:http';
import app from './index';
import { randomBytes, createHash } from "node:crypto";
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
    let testUser1: Awaited<ReturnType<typeof createUser>> | undefined;
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