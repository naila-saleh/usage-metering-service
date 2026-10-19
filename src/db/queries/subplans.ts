import { db } from "../index.js";
import { NewSubplan, subplans } from "../schema.js";
import { eq, and, or } from "drizzle-orm";

export async function createSubplan(subplan: NewSubplan) {
    const [result] = await db
        .insert(subplans)
        .values(subplan)
        .returning();
    return result;
}

export async function updateSubplan(id: string, subplan: Partial<NewSubplan>) {
    const [result] = await db
        .update(subplans)
        .set(subplan)
        .where(eq(subplans.id, id))
        .returning();
    return result;
}

export async function getAllSubplans() {
    const result = await db.select().from(subplans).orderBy(subplans.created_at);
    return result;
}

export async function getSubplanById(id: string) {
    const [result] = await db.select().from(subplans).where(eq(subplans.id, id));
    return result;
}

export async function getSubplansByPlanId(planId: string, accountId: string) {
    return  await db.select().from(subplans).where(and(eq(subplans.plan_id, planId), or(eq(subplans.created_by_account_id, accountId), eq(subplans.is_system_plan, true)))).orderBy(subplans.created_at);
}

export async function getSubplanByName(planId: string, name: string) {
    const [result] = await db.select().from(subplans).where(and(eq(subplans.plan_id, planId), eq(subplans.name, name)));
    return result;
}

export async function deactivateSubplanById(id: string) {
    const [result] = await db.update(subplans).set({ is_active: false }).where(eq(subplans.id, id)).returning();
    return result;
}

export async function activateSubplanById(id: string) {
    const [result] = await db.update(subplans).set({ is_active: true }).where(eq(subplans.id, id)).returning();
    return result;
}