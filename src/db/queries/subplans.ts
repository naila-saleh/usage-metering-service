import { db } from "../index.js";
import { NewSubplan, subplans } from "../schema.js";
import { eq } from "drizzle-orm";

export async function createSubplan(subplan: NewSubplan) {
    const [result] = await db
        .insert(subplans)
        .values(subplan)
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

export async function getSubplansByPlanId(planId: string) {
    const result = await db.select().from(subplans).where(eq(subplans.plan_id, planId)).orderBy(subplans.created_at);
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