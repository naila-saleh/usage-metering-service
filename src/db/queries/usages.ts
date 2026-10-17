import { db } from "../index.js";
import type { Transaction } from "../index.js";
import { NewUsage, usages } from "../schema.js";
import { eq, gte, lt, and, desc, sum } from "drizzle-orm";

export async function createUsage(usage: NewUsage, transaction?: Transaction) {
    if (transaction) {
        const [result] = await transaction.insert(usages).values(usage).returning();
        return result;
    }
    const [result] = await db.insert(usages).values(usage).returning();
    return result;
}

export async function getUsageByRequestId(requestId: string, accountId: string, transaction?: Transaction) {
    if (transaction) {
        const usage = await transaction.select().from(usages).where(and(eq(usages.request_id, requestId), eq(usages.account_id, accountId))).limit(1);
        return usage[0];
    }
    const usage = await db.select().from(usages).where(and(eq(usages.request_id, requestId), eq(usages.account_id, accountId))).limit(1);
    return usage[0];
}

export async function getMonthlyUserUsage(userId: string, accountId: string, startDate: Date, endDate: Date, transaction?: Transaction) {
    if (transaction) {
        const [usage] = await transaction.select({ total: sum(usages.amount) }).from(usages).where(and(
            eq(usages.user_id, userId),
            eq(usages.account_id, accountId),
            gte(usages.created_at, startDate),
            lt(usages.created_at, endDate),
            eq(usages.is_success, true)
        ));
        return Number(usage?.total ?? 0);
    }
    const [usage] = await db.select({ total: sum(usages.amount) }).from(usages).where(and(
        eq(usages.user_id, userId),
        eq(usages.account_id, accountId),
        gte(usages.created_at, startDate),
        lt(usages.created_at, endDate),
        eq(usages.is_success, true)
    ));
    return Number(usage?.total ?? 0);
}

export async function getMonthlyAccountUsage(accountId: string, startDate: Date, endDate: Date, transaction?: Transaction) {
    if (transaction) {
        const [usage] = await transaction.select({ total: sum(usages.amount) }).from(usages).where(and(
            eq(usages.account_id, accountId),
            gte(usages.created_at, startDate),
            lt(usages.created_at, endDate),
            eq(usages.is_success, true)
        ));
        return Number(usage?.total ?? 0);
    }
    const [usage] = await db.select({ total: sum(usages.amount) }).from(usages).where(and(
        eq(usages.account_id, accountId),
        gte(usages.created_at, startDate),
        lt(usages.created_at, endDate),
        eq(usages.is_success, true)
    ));
    return Number(usage?.total ?? 0);
}

export async function getUserUsageHistory(userId: string, accountId: string, limit: number = 10, page: number = 1) {
    const offset = (page - 1) * limit;
    const usage = await db.select().from(usages).where(and(
        eq(usages.user_id, userId),
        eq(usages.account_id, accountId)
    )).orderBy(desc(usages.created_at)).limit(limit).offset(offset);
    return usage;
}

export async function getAccountUsageHistory(accountId: string, limit: number = 10, page: number = 1) {
    const offset = (page - 1) * limit;
    const usage = await db.select().from(usages).where(eq(usages.account_id, accountId)).orderBy(desc(usages.created_at)).limit(limit).offset(offset);
    return usage;
}

export async function setUsageSuccess(requestId: string, accountId: string, transaction?: Transaction) {
    if (transaction) {
        const [result] = await transaction.update(usages).set({ is_success: true }).where(and(eq(usages.request_id, requestId), eq(usages.account_id, accountId))).returning();
        return result;
    }
    const [result] = await db.update(usages).set({ is_success: true }).where(and(eq(usages.request_id, requestId), eq(usages.account_id, accountId))).returning();
    return result;
}

export async function deleteUsageById(id: string) {
    const [result] = await db.delete(usages).where(eq(usages.id, id)).returning();
    return result;
}

export async function deleteUsageByRequestId(requestId: string, accountId: string) {
    const [result] = await db.delete(usages).where(and(eq(usages.request_id, requestId), eq(usages.account_id, accountId))).returning();
    return result;
}

export async function deleteUsageHistoryByUserId(userId: string, accountId: string) {
    return await db.delete(usages).where(and(eq(usages.user_id, userId), eq(usages.account_id, accountId))).returning();
}

export async function deleteUsageHistoryByAccountId(accountId: string) {
    return await db.delete(usages).where(eq(usages.account_id, accountId)).returning();
}