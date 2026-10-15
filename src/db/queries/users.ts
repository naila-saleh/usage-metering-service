import { db } from "../index.js";
import { NewUser, users } from "../schema.js";
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