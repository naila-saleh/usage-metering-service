import { db } from "../index.js";
import type { Transaction } from "../index.js";
import { NewUser, users, subplans } from "../schema.js";
import { eq, and } from "drizzle-orm";

export async function createUser(user: NewUser) {
    const [result] = await db
        .insert(users)
        .values(user)
        .returning();
    return result;
}

export async function getAllUsersByAccountId(accountId: string) {
    const result = await db.select().from(users).where(eq(users.account_id, accountId));
    return result;
}

export async function getUserById(id: string, accountId: string) {
    const [result] = await db.select().from(users).where(and(eq(users.account_id, accountId), eq(users.id, id)));
    return result;
}

export async function deactivateUserById(id: string, accountId: string) {
    const [result] = await db.update(users).set({ is_active: false }).where(and(eq(users.account_id, accountId), eq(users.id, id))).returning();
    return result;
}

export async function activateUserById(id: string, accountId: string) {
    const [result] = await db.update(users).set({ is_active: true }).where(and(eq(users.account_id, accountId), eq(users.id, id))).returning();
    return result;
}

export async function getUserAndSubplanByUserId(userId: string, accountId: string, transaction?: Transaction) {
    if (transaction) {
        const [result] = await transaction.select().from(users).innerJoin(subplans, eq(users.subplan_id, subplans.id)).where(and(eq(users.account_id, accountId), eq(users.id, userId))).for('update', { of: users });
        return result;
    }
    const [result] = await db.select().from(users).innerJoin(subplans, eq(users.subplan_id, subplans.id)).where(and(eq(users.account_id, accountId), eq(users.id, userId)));
    return result;
}

export async function deleteUserById(id: string, accountId: string) {
    const [result] = await db.delete(users).where(and(eq(users.account_id, accountId), eq(users.id, id))).returning();
    return result;
}

export async function updateUserSubplan(userId: string, accountId: string, newSubplanId: string) {
    const [result] = await db.update(users).set({ subplan_id: newSubplanId }).where(and(eq(users.account_id, accountId), eq(users.id, userId))).returning();
    return result;
}