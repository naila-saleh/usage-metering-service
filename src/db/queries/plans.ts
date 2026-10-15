import { db } from "../index.js";
import { NewPlan, plans } from "../schema.js";
import { eq } from "drizzle-orm";

export async function createPlan(plan: NewPlan) {
    const [result] = await db
        .insert(plans)
        .values(plan)
        .returning();
    return result;
}

export async function getAllPlans() {
    const result = await db.select().from(plans).orderBy(plans.created_at);
    return result;
}

export async function getPlanById(id: string) {
    const [result] = await db.select().from(plans).where(eq(plans.id, id));
    return result;
}

export async function deactivatePlanById(id: string) {
    const [result] = await db.update(plans).set({ is_active: false }).where(eq(plans.id, id)).returning();
    return result;
}

export async function activatePlanById(id: string) {
    const [result] = await db.update(plans).set({ is_active: true }).where(eq(plans.id, id)).returning();
    return result;
}