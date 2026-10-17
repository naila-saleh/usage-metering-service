import { db } from "../index.js";
import type { Transaction } from "../index.js";
import { NewAccount, accounts, subplans } from "../schema.js";
import { eq } from "drizzle-orm";

export async function createAccount(account: NewAccount) {
    const [result] = await db
        .insert(accounts)
        .values(account)
        .returning();
    return result;
}

export async function getAllAccounts() {
    const result = await db.select().from(accounts).orderBy(accounts.created_at);
    return result;
}

export async function getAccountById(id: string) {
    const [result] = await db.select().from(accounts).where(eq(accounts.id, id));
    return result;
}

export async function getAccountByHashedApiKey(hashedApiKey: string) {
    const [result] = await db.select().from(accounts).where(eq(accounts.hashed_api_key, hashedApiKey));
    return result;
}

export async function deactivateAccountById(id: string) {
    const [result] = await db.update(accounts).set({ is_active: false }).where(eq(accounts.id, id)).returning();
    return result;
}

export async function activateAccountById(id: string) {
    const [result] = await db.update(accounts).set({ is_active: true }).where(eq(accounts.id, id)).returning();
    return result;
}

export async function getAccountAndSubplanByAccountId(accountId: string, transaction?: Transaction) {
    if (transaction) {
        const [result] = await transaction.select().from(accounts).innerJoin(subplans, eq(accounts.subplan_id, subplans.id)).where(eq(accounts.id, accountId)).for('update', { of: accounts });
        return result;
    }
    const [result] = await db.select().from(accounts).innerJoin(subplans, eq(accounts.subplan_id, subplans.id)).where(eq(accounts.id, accountId));
    return result;
}

export async function deleteAccountById(id: string) {
    const [result] = await db.delete(accounts).where(eq(accounts.id, id)).returning();
    return result;
}