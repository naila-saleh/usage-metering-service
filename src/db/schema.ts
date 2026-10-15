import {pgTable, timestamp, varchar, uuid, boolean, integer, unique, decimal} from "drizzle-orm/pg-core";

export const plans = pgTable("plans", {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    name: varchar("name", { length: 256 }).unique().notNull(),
    description: varchar("description", { length: 1024 }).notNull(),
    is_active: boolean("is_active").notNull().default(true),
});

export type NewPlan = typeof plans.$inferInsert;

export const subplans = pgTable("subplans", {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    plan_id: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    description: varchar("description", { length: 1024 }).notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    is_active: boolean("is_active").notNull().default(true),
    monthly_limit: integer("monthly_limit").notNull(),
    max_request_limit: integer("max_request_limit").notNull(),
    is_system_plan: boolean("is_system_plan").notNull().default(false),
    created_by_account_id: uuid("created_by_account_id"),
});

export type NewSubplan = typeof subplans.$inferInsert;

export const accounts = pgTable("accounts", {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    name: varchar("name", { length: 256 }).unique().notNull(),
    is_active: boolean("is_active").notNull().default(true),
    hashed_api_key: varchar("hashed_api_key", { length: 256 }).notNull(),
    subplan_id: uuid("subplan_id").notNull().references(() => subplans.id, { onDelete: "cascade" }),
});

export type NewAccount = typeof accounts.$inferInsert;

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    email: varchar("email", { length: 256 }).unique().notNull(),
    hashed_password: varchar("hashed_password", { length: 256 }).notNull().$defaultFn(() => "unset"),
    is_active: boolean("is_active").notNull().default(true),
    is_admin: boolean("is_admin").notNull().default(false),
    account_id: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    subplan_id: uuid("subplan_id").notNull().references(() => subplans.id, { onDelete: "cascade" }),
});

export type NewUser = typeof users.$inferInsert;

export const usages = pgTable("usages", {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at")
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
    request_id: uuid("request_id").notNull(),
    amount: integer("amount").notNull().default(0),
    user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    account_id: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    is_success: boolean("is_success").notNull().default(false),
    rejected_by: varchar("rejected_by", { length: 256 }).notNull().default(""),
    rejected_reason: varchar("rejected_reason", { length: 256 }).notNull().default(""),
}, (table) => {
    return {
        unique_request_constraint: unique("unique_request_constraint").on(table.request_id, table.account_id),
    };
});

export type NewUsage = typeof usages.$inferInsert;