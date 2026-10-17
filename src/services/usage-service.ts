import { getUsageByRequestId, createUsage, setUsageSuccess, getMonthlyAccountUsage, getMonthlyUserUsage } from "../db/queries/usages";
import { getAccountAndSubplanByAccountId } from "../db/queries/accounts";
import { getUserAndSubplanByUserId } from "../db/queries/users";
import { db } from "../db";

function getSubscriptionDate(subscriptionStartedAt: Date, monthsToAdd: number, startsAtMonthEnd: boolean): Date {
    const targetDate = new Date(subscriptionStartedAt);
    targetDate.setDate(1);
    targetDate.setMonth(targetDate.getMonth() + monthsToAdd);
    const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
    const day = startsAtMonthEnd ? lastDay : Math.min(subscriptionStartedAt.getDate(), lastDay);
    targetDate.setDate(day);
    return targetDate;
}

function getCurrentSubscriptionCycle(subscriptionStartedAt: Date, now: Date = new Date()) {
    if (now < subscriptionStartedAt) {
        throw new Error("Subscription has not started yet");
    }
    const lastDayOfStartMonth = new Date(subscriptionStartedAt.getFullYear(), subscriptionStartedAt.getMonth() + 1, 0).getDate();
    const startsAtMonthEnd = subscriptionStartedAt.getDate() === lastDayOfStartMonth;
    let monthsElapsed = (now.getFullYear() - subscriptionStartedAt.getFullYear()) * 12 + now.getMonth() - subscriptionStartedAt.getMonth();
    let startDate = getSubscriptionDate(subscriptionStartedAt, monthsElapsed, startsAtMonthEnd);
    if (now < startDate) {
        monthsElapsed--;
        startDate = getSubscriptionDate(subscriptionStartedAt, monthsElapsed, startsAtMonthEnd);
    }
    const endDate = getSubscriptionDate(subscriptionStartedAt, monthsElapsed + 1, startsAtMonthEnd);
    return { start: startDate, end: endDate };
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
            if (existingUsage) {
                return existingUsage.is_success? existingUsage :new Error(existingUsage.rejected_reason);
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