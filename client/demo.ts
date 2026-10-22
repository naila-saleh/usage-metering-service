import {existsSync} from "node:fs";
import { randomUUID } from "node:crypto";
import { NewSubplan } from "../src/db/schema.js";

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
    const createUsageConsume = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, rejectedBy: string, error: string }>(`/usage/consume`, 'POST', apiKey, {
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
    const createUsageConsumeAfterPlanChange = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, rejectedBy: string, error: string }>(`/usage/consume`, 'POST', apiKey, {
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
    if (!('rejectedBy' in createUsageConsumeAfterPlanChange.body) || createUsageConsumeAfterPlanChange.body.rejectedBy !== "user") {
        throw new Error(`Expected rejectedBy to be "user", but got: ${JSON.stringify(createUsageConsumeAfterPlanChange.body)}`);
    }
    console.log(`Correctly received error when trying to consume 11 units of usage for user ${userId} after plan change: ${createUsageConsumeAfterPlanChange.body.error}, rejected by: ${createUsageConsumeAfterPlanChange.body.rejectedBy}`)
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
    const createUsageConsumePremiumUser = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, rejectedBy: string, error: string }>(`/usage/consume`, 'POST', apiKey, {
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
    const createUsageConsumeAfterDowngrade = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, rejectedBy: string, error: string }>(`/usage/consume`, 'POST', apiKey, {
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
    if (!('rejectedBy' in createUsageConsumeAfterDowngrade.body) || createUsageConsumeAfterDowngrade.body.rejectedBy !== "account") {
        throw new Error(`Expected rejectedBy to be "account" after downgrade, but got: ${JSON.stringify(createUsageConsumeAfterDowngrade.body)}`);
    }
    console.log(`Correctly received error when trying to consume 2 units of usage for premium user ${premiumUserId} after plan downgrade: ${createUsageConsumeAfterDowngrade.body.error}, rejected by: ${createUsageConsumeAfterDowngrade.body.rejectedBy}`)
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
    const createUsageConsumeAfterUpgrade = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, rejectedBy: string, error: string }>(`/usage/consume`, 'POST', apiKey, {
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
    if (patchAccountPlanToStarterAgain.code !== 200) {
        throw new Error(`Failed to update account plan: ${patchAccountPlanToStarterAgain.code}`);
    }
    if (!('planName' in patchAccountPlanToStarterAgain.body) || patchAccountPlanToStarterAgain.body.planName !== "Starter") {
        throw new Error(`Failed to update account plan: ${JSON.stringify(patchAccountPlanToStarterAgain.body)}`);
    }
    console.log(`Updated account plan to Starter for account ${createAccount.body.accountId}`);
    const createUsageConsumeAfterDowngradeAgain = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, rejectedBy: string, error: string }>(`/usage/consume`, 'POST', apiKey, {
        userId: premiumUserId,
        requestId: randomUUID(),
        units: 2
    });
    if (createUsageConsumeAfterDowngradeAgain.code !== 403) {
        throw new Error(`Expected 403 Forbidden when consuming usage after plan downgrade again, but got: ${createUsageConsumeAfterDowngradeAgain.code}`);
    }
    if (!('error' in createUsageConsumeAfterDowngradeAgain.body) || !createUsageConsumeAfterDowngradeAgain.body.error.includes("exceeded")) {
        throw new Error(`Expected error message about exceeding usage limit after downgrade again, but got: ${JSON.stringify(createUsageConsumeAfterDowngradeAgain.body)}`);
    }
    if (!('rejectedBy' in createUsageConsumeAfterDowngradeAgain.body) || createUsageConsumeAfterDowngradeAgain.body.rejectedBy !== "account") {
        throw new Error(`Expected rejectedBy to be "account" after downgrade again, but got: ${JSON.stringify(createUsageConsumeAfterDowngradeAgain.body)}`);
    }
    console.log(`Correctly received error when trying to consume 2 units of usage for premium user ${premiumUserId} after plan downgrade again: ${createUsageConsumeAfterDowngradeAgain.body.error}, rejected by: ${createUsageConsumeAfterDowngradeAgain.body.rejectedBy}`);
    const getUsageSummary = await request<{ account: { monthlyLimit: number, used: number, remaining: number, }, user: { monthlyLimit: number, used: number, remaining: number } } | { error: string }>(`/usage/summary?userId=${premiumUserId}`, 'GET', apiKey);
    if (getUsageSummary.code !== 200) {
        throw new Error(`Failed to get usage summary: ${getUsageSummary.code}`);
    }
    if (!('account' in getUsageSummary.body) || !('user' in getUsageSummary.body)) {
        throw new Error(`Failed to get usage summary: ${JSON.stringify(getUsageSummary.body)}`);
    }
    console.log(`Usage summary for account ${createAccount.body.accountId} and user ${premiumUserId}:`);
    console.log(`Account - Monthly Limit: ${getUsageSummary.body.account.monthlyLimit}, Used: ${getUsageSummary.body.account.used}, Remaining: ${getUsageSummary.body.account.remaining}`);
    console.log(`User - Monthly Limit: ${getUsageSummary.body.user.monthlyLimit}, Used: ${getUsageSummary.body.user.used}, Remaining: ${getUsageSummary.body.user.remaining}`);

    const getPlans = await request<{ accountPlans: NewSubplan[], userPlans: NewSubplan[] } | { error: string }>('/plans', 'GET', apiKey);
    if (getPlans.code !== 200) {
        throw new Error(`Failed to get plans: ${getPlans.code}`);
    }
    if (!('userPlans' in getPlans.body) || getPlans.body.userPlans.length === 0) {
        throw new Error(`Failed to get user plans: ${JSON.stringify(getPlans.body)}`);
    }
    const planId = getPlans.body.userPlans[0].plan_id;
    console.log(`Retrieved user plan ID: ${planId}`);
    const createSubplan = await request< NewSubplan  | { error: string }>(`/plans/${planId}/subplans`, 'POST', apiKey, {
        name: `Demo Subplan ${randomUUID()}`,
        description: 'Demo subplan for usage metering service',
        price: "5.99",
        monthly_limit: 50,
        max_request_limit: 5,
    });
    if (createSubplan.code !== 201) {
        throw new Error(`Failed to create subplan: ${createSubplan.code}`);
    }
    if (!('plan_id' in createSubplan.body)) {
        throw new Error(`Failed to create subplan: ${JSON.stringify(createSubplan.body)}`);
    }
    console.log(`Created subplan with ID: ${createSubplan.body.id}`);
    const subplanId = createSubplan.body.id;
    const subplanName = createSubplan.body.name;
    const subplanCreateUser = await request<{ userId: string, email: string, planName: string} | { error: string }>(`/users`, 'POST', apiKey, {
        email: `subplan-user-${randomUUID()}@example.com`,
        planName: subplanName,
    });
    if (subplanCreateUser.code !== 201) {
        throw new Error(`Failed to create user with subplan: ${subplanCreateUser.code}`);
    }
    if (!('userId' in subplanCreateUser.body)) {
        throw new Error(`Failed to create user with subplan: ${JSON.stringify(subplanCreateUser.body)}`);
    }
    const subplanUserId = subplanCreateUser.body.userId;
    console.log(`Created user ${subplanCreateUser.body.email} with ID ${subplanUserId} under subplan ${subplanId}`);
    const updateAccountToPro = await request<{accountId: string, accountName: string, planName: string} | { error: string }>('/accounts/me/plan', 'PATCH', apiKey, {
        planName: "Pro"
    });
    if (updateAccountToPro.code !== 200) {
        throw new Error(`Failed to update account plan to Pro: ${updateAccountToPro.code}`);
    }
    if (!('planName' in updateAccountToPro.body) || updateAccountToPro.body.planName !== "Pro") {
        throw new Error(`Failed to update account plan to Pro: ${JSON.stringify(updateAccountToPro.body)}`);
    }
    console.log(`Updated account plan to Pro for account ${createAccount.body.accountId}`);
    const createUsageConsumeSubplanUser = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, rejectedBy: string, error: string }>(`/usage/consume`, 'POST', apiKey, {
        userId: subplanUserId,
        requestId: randomUUID(),
        units: 6
    });
    if (createUsageConsumeSubplanUser.code !== 403) {
        throw new Error(`Expected 403 Forbidden when consuming usage for subplan user exceeding limit, but got: ${createUsageConsumeSubplanUser.code}`);
    }
    if (!('error' in createUsageConsumeSubplanUser.body) || !createUsageConsumeSubplanUser.body.error.includes("exceeded")) {
        throw new Error(`Expected error message about exceeding usage limit for subplan user, but got: ${JSON.stringify(createUsageConsumeSubplanUser.body)}`);
    }
    if (!('rejectedBy' in createUsageConsumeSubplanUser.body) || createUsageConsumeSubplanUser.body.rejectedBy !== "user") {
        throw new Error(`Expected rejectedBy to be "user" for subplan user, but got: ${JSON.stringify(createUsageConsumeSubplanUser.body)}`);
    }
    console.log(`Correctly received error when trying to consume 6 units of usage for subplan user ${subplanUserId}: ${createUsageConsumeSubplanUser.body.error}, rejected by: ${createUsageConsumeSubplanUser.body.rejectedBy}`);
    const updateSubplan = await request< NewSubplan  | { error: string }>(`/plans/${planId}/subplans/${subplanId}`, 'PATCH', apiKey, {
        max_request_limit: 20,
    });
    if (updateSubplan.code !== 200) {
        throw new Error(`Failed to update subplan: ${updateSubplan.code}`);
    }
    if (!('plan_id' in updateSubplan.body) || updateSubplan.body.max_request_limit !== 20) {
        throw new Error(`Failed to update subplan: ${JSON.stringify(updateSubplan.body)}`);
    }
    console.log(`Updated subplan ${subplanId} max_request_limit to 20`);
    const createUsageConsumeSubplanUserAfterUpdate = await request<{ success: boolean, unitsConsumed: number } | { success: boolean, rejectedBy: string, error: string }>(`/usage/consume`, 'POST', apiKey, {
        userId: subplanUserId,
        requestId: randomUUID(),
        units: 6
    });
    if (createUsageConsumeSubplanUserAfterUpdate.code !== 200) {
        throw new Error(`Failed to consume usage for subplan user after update: ${createUsageConsumeSubplanUserAfterUpdate.code}`);
    }
    if (!('success' in createUsageConsumeSubplanUserAfterUpdate.body) || !createUsageConsumeSubplanUserAfterUpdate.body.success) {
        throw new Error(`Failed to consume usage for subplan user after update: ${JSON.stringify(createUsageConsumeSubplanUserAfterUpdate.body)}`);
    }
    console.log(`Consumed 6 units of usage for subplan user ${subplanUserId} after subplan update`);
    const getSubplanUsageSummary = await request<{ account: { monthlyLimit: number, used: number, remaining: number, }, user: { monthlyLimit: number, used: number, remaining: number } } | { error: string }>(`/usage/summary?userId=${subplanUserId}`, 'GET', apiKey);
    if (getSubplanUsageSummary.code !== 200) {
        throw new Error(`Failed to get usage summary for subplan user: ${getSubplanUsageSummary.code}`);
    }
    if (!('account' in getSubplanUsageSummary.body) || !('user' in getSubplanUsageSummary.body)) {
        throw new Error(`Failed to get usage summary for subplan user: ${JSON.stringify(getSubplanUsageSummary.body)}`);
    }
    console.log(`Usage summary for account ${createAccount.body.accountId} and subplan user ${subplanUserId}:`);
    console.log(`Account - Monthly Limit: ${getSubplanUsageSummary.body.account.monthlyLimit}, Used: ${getSubplanUsageSummary.body.account.used}, Remaining: ${getSubplanUsageSummary.body.account.remaining}`);
    console.log(`User - Monthly Limit: ${getSubplanUsageSummary.body.user.monthlyLimit}, Used: ${getSubplanUsageSummary.body.user.used}, Remaining: ${getSubplanUsageSummary.body.user.remaining}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});