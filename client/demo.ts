import {existsSync} from "node:fs";
import { randomUUID } from "node:crypto";

type HttpMethod = 'GET' | 'POST' | 'PATCH';
const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";

if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
}
let mode: string;
if (process.env.PLATFORM === "dev"){
    mode = "localhost";
}else if (process.env.PLATFORM === "production"){
    mode = "api";
}else {
    throw new Error("PLATFORM environment variable must be set to 'dev' or 'production'");
}

export async function request<T>(path: string, method: HttpMethod, apiKey?: string, body?: unknown) {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (apiKey) {
        headers['x-api-key'] = apiKey;
    }

    const response = await fetch(`http://${mode}:8080${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    return {
        code: response.status,
        body: await response.json() as T,
    }
}

export async function main() {
    const uniqueId = randomUUID();
    const createAccount = await request<{ accountId: string, accountName: string, planName: string, apiKey: string } | { error: string }>('/accounts', 'POST', undefined, {
        name: `Demo Account ${uniqueId}`,
        planName: "Starter",
    });
    if (createAccount.code !== 201) {
        throw new Error(`Failed to create account: ${createAccount.code}`);
    }
    if (!('accountId' in createAccount.body) || !('apiKey' in createAccount.body)) {
        throw new Error(`Failed to create account: ${JSON.stringify(createAccount.body)}`);
    }
    const apiKey = createAccount.body.apiKey;
    console.log(`Created account ${createAccount.body.accountName} with ID ${createAccount.body.accountId}`);
    const getAccount = await request<{ accountId: string, accountName: string, isActive: boolean }>('/accounts/me' , 'GET', apiKey);
    if (getAccount.code !== 200) {
        throw new Error(`Failed to get account: ${getAccount.code}`);
    }
    if (createAccount.body.accountId !== getAccount.body.accountId) {
        throw new Error(`Account IDs do not match: ${createAccount.body.accountId} !== ${getAccount.body.accountId}`);
    }
    console.log("API key verified successfully");
    const createUser = await request<{ userId: string, email: string, planName: string} | { error: string }>(`/users`, 'POST', apiKey, {
        email: `demo-${uniqueId}@example.com`,
        planName: "Basic",
    });
    if (createUser.code !== 201) {
        throw new Error(`Failed to create user: ${createUser.code}`);
    }
    if (!('userId' in createUser.body)) {
        throw new Error(`Failed to create user: ${JSON.stringify(createUser.body)}`);
    }
    const userId = createUser.body.userId;
    console.log(`Created user ${createUser.body.email} with ID ${userId}`);
    const createUsageConsume = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, error: string }>(`/usage/consume`, 'POST', apiKey, {
        userId: userId,
        requestId: uniqueId,
        units: 2
    });
    if (createUsageConsume.code !== 200) {
        throw new Error(`Failed to consume usage: ${createUsageConsume.code}`);
    }
    if (!('success' in createUsageConsume.body) || !createUsageConsume.body.success) {
        throw new Error(`Failed to consume usage: ${JSON.stringify(createUsageConsume.body)}`);
    }
    console.log(`Consumed 2 units of usage for user ${userId}`);
    const patchAccountPlan = await request<{accountId: string, accountName: string, planName: string} | { error: string }>('/accounts/me/plan', 'PATCH', apiKey, {
        planName: "Pro"
    });
    if (patchAccountPlan.code !== 200) {
        throw new Error(`Failed to update account plan: ${patchAccountPlan.code}`);
    }
    if (!('planName' in patchAccountPlan.body) || patchAccountPlan.body.planName !== "Pro") {
        throw new Error(`Failed to update account plan: ${JSON.stringify(patchAccountPlan.body)}`);
    }
    console.log(`Updated account plan to Pro for account ${createAccount.body.accountId}`);
    const createUsageConsumeAfterPlanChange = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, error: string }>(`/usage/consume`, 'POST', apiKey, {
        userId: userId,
        requestId: randomUUID(),
        units: 11
    });
    if (createUsageConsumeAfterPlanChange.code !== 403) {
        throw new Error(`Expected 403 Forbidden when consuming usage after plan change, but got: ${createUsageConsumeAfterPlanChange.code}`);
    }
    if (!('error' in createUsageConsumeAfterPlanChange.body) || !createUsageConsumeAfterPlanChange.body.error.includes("exceeded")) {
        throw new Error(`Expected error message about exceeding usage limit, but got: ${JSON.stringify(createUsageConsumeAfterPlanChange.body)}`);
    }
    console.log(`Correctly received error when trying to consume 11 units of usage for user ${userId} after plan change: ${createUsageConsumeAfterPlanChange.body.error}`)
    const createPremiumUser = await request<{ userId: string, email: string, planName: string} | { error: string }>(`/users`, 'POST', apiKey, {
        email: `premium-user-${randomUUID()}@example.com`,
        planName: "Premium"
    });
    if (createPremiumUser.code !== 201) {
        throw new Error(`Failed to create premium user: ${createPremiumUser.code}`);
    }
    if (!('userId' in createPremiumUser.body)) {
        throw new Error(`Failed to create premium user: ${JSON.stringify(createPremiumUser.body)}`);
    }
    const premiumUserId = createPremiumUser.body.userId;
    console.log(`Created premium user ${createPremiumUser.body.email} with ID ${premiumUserId}`);
    const createUsageConsumePremiumUser = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, error: string }>(`/usage/consume`, 'POST', apiKey, {
        userId: premiumUserId,
        requestId: randomUUID(),
        units: 97
    });
    if (createUsageConsumePremiumUser.code !== 200) {
        throw new Error(`Failed to consume usage for premium user: ${createUsageConsumePremiumUser.code}`);
    }
    if (!('success' in createUsageConsumePremiumUser.body) || !createUsageConsumePremiumUser.body.success) {
        throw new Error(`Failed to consume usage for premium user: ${JSON.stringify(createUsageConsumePremiumUser.body)}`);
    }
    console.log(`Consumed 97 units of usage for premium user ${premiumUserId}`);
    const patchAccountPlanToStarter = await request<{accountId: string, accountName: string, planName: string} | { error: string }>('/accounts/me/plan', 'PATCH', apiKey, {
        planName: "Starter"
    });
    if (patchAccountPlanToStarter.code !== 200) {
        throw new Error(`Failed to update account plan: ${patchAccountPlanToStarter.code}`);
    }
    if (!('planName' in patchAccountPlanToStarter.body) || patchAccountPlanToStarter.body.planName !== "Starter") {
        throw new Error(`Failed to update account plan: ${JSON.stringify(patchAccountPlanToStarter.body)}`);
    }
    console.log(`Updated account plan to Starter for account ${createAccount.body.accountId}`);
    const createUsageConsumeAfterDowngrade = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, error: string }>(`/usage/consume`, 'POST', apiKey, {
        userId: premiumUserId,
        requestId: randomUUID(),
        units: 2
    });
    if (createUsageConsumeAfterDowngrade.code !== 403) {
        throw new Error(`Expected 403 Forbidden when consuming usage after plan downgrade, but got: ${createUsageConsumeAfterDowngrade.code}`);
    }
    if (!('error' in createUsageConsumeAfterDowngrade.body) || !createUsageConsumeAfterDowngrade.body.error.includes("exceeded")) {
        throw new Error(`Expected error message about exceeding usage limit after downgrade, but got: ${JSON.stringify(createUsageConsumeAfterDowngrade.body)}`);
    }
    console.log(`Correctly received error when trying to consume 2 units of usage for premium user ${premiumUserId} after plan downgrade: ${createUsageConsumeAfterDowngrade.body.error}`)
    const patchAccountPlanToPro = await request<{accountId: string, accountName: string, planName: string} | { error: string }>('/accounts/me/plan', 'PATCH', apiKey, {
        planName: "Pro"
    });
    if (patchAccountPlanToPro.code !== 200) {
        throw new Error(`Failed to update account plan: ${patchAccountPlanToPro.code}`);
    }
    if (!('planName' in patchAccountPlanToPro.body) || patchAccountPlanToPro.body.planName !== "Pro") {
        throw new Error(`Failed to update account plan: ${JSON.stringify(patchAccountPlanToPro.body)}`);
    }
    console.log(`Updated account plan to Pro for account ${createAccount.body.accountId}`);
    const createUsageConsumeAfterUpgrade = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, error: string }>(`/usage/consume`, 'POST', apiKey, {
        userId: premiumUserId,
        requestId: randomUUID(),
        units: 2
    });
    if (createUsageConsumeAfterUpgrade.code !== 200) {
        throw new Error(`Failed to consume usage after plan upgrade: ${createUsageConsumeAfterUpgrade.code}`);
    }
    if (!('success' in createUsageConsumeAfterUpgrade.body) || !createUsageConsumeAfterUpgrade.body.success) {
        throw new Error(`Failed to consume usage after plan upgrade: ${JSON.stringify(createUsageConsumeAfterUpgrade.body)}`);
    }
    console.log(`Consumed 2 units of usage for premium user ${premiumUserId} after plan upgrade`);
    const patchAccountPlanToStarterAgain = await request<{accountId: string, accountName: string, planName: string} | { error: string }>('/accounts/me/plan', 'PATCH', apiKey, {
        planName: "Starter"
    });
    if (patchAccountPlanToStarterAgain.code !== 409) {
        throw new Error(`Expected 409 Conflict when downgrading account plan when monthly usage exceeds the Starter limit, but got: ${patchAccountPlanToStarterAgain.code}`);
    }
    if (!('error' in patchAccountPlanToStarterAgain.body)) {
        throw new Error(`Expected error message about exceeding the new plan's monthly limit, but got: ${JSON.stringify(patchAccountPlanToStarterAgain.body)}`);
    }
    console.log(`Correctly received error when trying to downgrade account plan to Starter due to exceeding monthly limit: ${patchAccountPlanToStarterAgain.body.error}`);

}

main().catch(err => {
    console.error(err);
    process.exit(1);
});