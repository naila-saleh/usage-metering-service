import { getUsageByRequestId, createUsage, setUsageSuccess, getMonthlyAccountUsage, getMonthlyUserUsage } from "../db/queries/usages";
import { getAccountAndSubplanByAccountId } from "../db/queries/accounts";
import { getUserAndSubplanByUserId } from "../db/queries/users";
import { db } from "../db";

export function getCurrentSubscriptionCycle(subscriptionStartedAt: Date, now: Date = new Date()) {
    if (now < subscriptionStartedAt) {
        throw new Error("Subscription has not started yet");
    }
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
}

export async function consumeUsage(accountId: string, userId: string, requestId: string, units: number) {
    const isUsageExists = await getUsageByRequestId(requestId, accountId);
    if (!isUsageExists || isUsageExists.is_success === false) {
        const result = await db.transaction(async (tx) => {
            const account = await getAccountAndSubplanByAccountId(accountId, tx);
            if (!account) {
                return new Error(`Account with ID ${accountId} not found`);
            }
            const existingUsage = await getUsageByRequestId(requestId, accountId, tx);
            if (existingUsage && existingUsage.amount === units) {
                return existingUsage.is_success? existingUsage :new Error(existingUsage.rejected_reason);
            }
            if (existingUsage && existingUsage.amount !== units) {
                return new Error(`Request with ID ${requestId} has already been processed with a different amount: ${existingUsage.amount}`);
            }
            const user = await getUserAndSubplanByUserId(userId, accountId, tx);
            if (!user) {
                return new Error(`User with ID ${userId} not found`);
            }
            if (!account.accounts.is_active) {
                return new Error(`Account with ID ${accountId} is not active`);
            }
            if (!user.users.is_active) {
                return new Error(`User with ID ${userId} is not active`);
            }
            if (!account.subplans.is_active) {
                return new Error(`Subplan for account with ID ${accountId} is not active`);
            }
            if (!user.subplans.is_active) {
                return  new Error(`Subplan for user with ID ${userId} is not active`);
            }
            if (units === null || units === undefined || isNaN(units) || typeof units !== "number") {
                return new Error(`Request with ID ${requestId} has invalid units: ${units}. Units must be a number`);
            }
            if (!Number.isFinite(units)) {
                return new Error(`Request with ID ${requestId} has invalid units: ${units}. Units must be a finite number`);
            }
            if (!Number.isInteger(units)) {
                return new Error(`Request with ID ${requestId} has invalid units: ${units}. Units must be an integer`);
            }
            if (units <= 0) {
                return new Error(`Request with ID ${requestId} has invalid units: ${units}. Units must be greater than 0`);
            }
            const now = new Date();
            const accountCycle = getCurrentSubscriptionCycle(account.accounts.subscription_started_at, now);
            const userCycle = getCurrentSubscriptionCycle(user.users.subscription_started_at, now);
            const monthlyAccountUsage = await getMonthlyAccountUsage(accountId, accountCycle.start, accountCycle.end, tx);
            const monthlyUserUsage = await getMonthlyUserUsage(userId, accountId, userCycle.start, userCycle.end, tx);
            if (units > account.subplans.max_request_limit) {
                await createUsage({request_id: requestId, account_id: accountId, user_id: userId, amount: units, rejected_by: "account", rejected_reason: "Account max request limit exceeded"}, tx);
                return new Error(`Request with ID ${requestId} exceeds the maximum request limit for account with ID ${accountId}`);
            }
            if (units > user.subplans.max_request_limit) {
                await createUsage({request_id: requestId, account_id: accountId, user_id: userId, amount: units, rejected_by: "user", rejected_reason: "User max request limit exceeded"}, tx);
                return new Error(`Request with ID ${requestId} exceeds the maximum request limit for user with ID ${userId}`);
            }
            if (monthlyAccountUsage + units > account.subplans.monthly_limit) {
                await createUsage({request_id: requestId, account_id: accountId, user_id: userId, amount: units, rejected_by: "account", rejected_reason: "Account monthly limit exceeded"}, tx);
                return new Error(`Account with ID ${accountId} has exceeded its monthly limit`);
            }
            if (monthlyUserUsage + units > user.subplans.monthly_limit) {
                await createUsage({request_id: requestId, account_id: accountId, user_id: userId, amount: units, rejected_by: "user", rejected_reason: "User monthly limit exceeded"}, tx);
                return new Error(`User with ID ${userId} has exceeded its monthly limit`);
            }
            let usage = await createUsage({request_id: requestId, account_id: accountId, user_id: userId, amount: units}, tx);
            if (usage) {
                usage = await setUsageSuccess(requestId, accountId, tx);
                return usage;
            }
        });
        if (result instanceof Error) {
            throw result;
        }
        return result;
    }
    return isUsageExists;
}

export async function getUsageSummary(accountId: string, userId: string, month?: number, year?: number) {
    const account = await getAccountAndSubplanByAccountId(accountId);
    if (!account) {
        throw new Error(`Account with ID ${accountId} not found`);
    }
    const user = await getUserAndSubplanByUserId(userId, accountId);
    if (!user) {
        throw new Error(`User with ID ${userId} not found`);
    }
    let accountCycle;
    let userCycle;
    let monthlyAccountUsage;
    let monthlyUserUsage;
    if (month === undefined || year === undefined) {
        const now = new Date();
        accountCycle = getCurrentSubscriptionCycle(account.accounts.subscription_started_at, now);
        userCycle = getCurrentSubscriptionCycle(user.users.subscription_started_at, now);
        monthlyAccountUsage = await getMonthlyAccountUsage(accountId, accountCycle.start, accountCycle.end);
        monthlyUserUsage = await getMonthlyUserUsage(userId, accountId, userCycle.start, userCycle.end);
        return {
            account: {
                monthlyLimit: account.subplans.monthly_limit,
                used: monthlyAccountUsage,
                remaining: Math.max(account.subplans.monthly_limit - monthlyAccountUsage, 0),
            },
            user: {
                monthlyLimit: user.subplans.monthly_limit,
                used: monthlyUserUsage,
                remaining: Math.max(user.subplans.monthly_limit - monthlyUserUsage, 0),
            },
        };
    }
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    monthlyAccountUsage = await getMonthlyAccountUsage(accountId, start, end);
    monthlyUserUsage = await getMonthlyUserUsage(userId, accountId, start, end);
    return {
        account: {
            monthlyLimit: account.subplans.monthly_limit,
            used: monthlyAccountUsage,
        },
        user: {
            monthlyLimit: user.subplans.monthly_limit,
            used: monthlyUserUsage,
        },
    };
}

export async function getUsageSummaryForAccount(accountId: string) {
    const account = await getAccountAndSubplanByAccountId(accountId);
    if (!account) {
        throw new Error(`Account with ID ${accountId} not found`);
    }
    const now = new Date();
    const accountCycle = getCurrentSubscriptionCycle(account.accounts.subscription_started_at, now);
    const monthlyAccountUsage = await getMonthlyAccountUsage(accountId, accountCycle.start, accountCycle.end);
    return {
        account: {
            monthlyLimit: account.subplans.monthly_limit,
            used: monthlyAccountUsage,
            remaining: Math.max(account.subplans.monthly_limit - monthlyAccountUsage, 0),
        },
    };
}