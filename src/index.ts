import express, { RequestHandler } from 'express'
import { config } from './config.js';
import { db } from "./db";
import { plans } from "./db/schema.js";
import { createHash, randomBytes } from 'node:crypto'
import { getAccountByHashedApiKey, createAccount, updateAccountSubplan } from './db/queries/accounts'
import {getPlanById, getPlanByName} from "./db/queries/plans";
import {getSubplanByName, updateSubplan, getSubplansByPlanId, createSubplan, getSubplanById} from "./db/queries/subplans";
import { createUser, getUserAndSubplanByUserId, updateUserSubplan } from "./db/queries/users";
import {
    getUsageByRequestId,
    getAccountUsageHistory,
    getUserUsageHistory,
} from "./db/queries/usages";
import {consumeUsage, getUsageSummary} from "./services/usage-service";


const app = express();
const port = config.api.port;

app.use(express.json());

const middlewareAuthenticateApiKey: RequestHandler =
    async (req, res, next) => {
        const apiKey = req.header('x-api-key');
        if (!apiKey) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const hashedApiKey = createHash('sha256').update(apiKey).digest('hex');
        const account = await getAccountByHashedApiKey(hashedApiKey);

        if (!account) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!account.is_active) {
            return res.status(403).json({ error: 'Account is inactive' });
        }

        res.locals.account = account;
        next();
    };

function ensureIdIsUUID(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
}
app.post("/accounts", async (req, res) => {
    const { name, planName } = req.body;
    if (!name || !planName || typeof name !== 'string' || typeof planName !== 'string' || name.trim() === '' || planName.trim() === '') {
        return res.status(400).json({ error: "Missing required fields: name, planName" });
    }
    const plan = await getPlanByName("Account Plans");
    if (!plan || !plan.is_active) {
        return res.status(400).json({ error: "Plan not found" });
    }
    const subplan = await getSubplanByName(plan.id, planName);
    if (!subplan || !subplan.is_active || !subplan.is_system_plan) {
        return res.status(400).json({ error: "Subplan not found" });
    }
    const apiKey = randomBytes(32).toString('hex');
    const hashedApiKey = createHash('sha256').update(apiKey).digest('hex');
    const newAccount = await createAccount({name: name, hashed_api_key: hashedApiKey, subplan_id: subplan.id});
    if (!newAccount) {
        return res.status(500).json({ error: "Failed to create account" });
    }
    return res.status(201).json({ accountId: newAccount.id, accountName: newAccount.name, planName: subplan.name, apiKey });
});

app.get('/accounts/me', middlewareAuthenticateApiKey, async (req, res) => {
    const account = res.locals.account;
    return res.status(200).json({ accountId: account.id, accountName: account.name, isActive: account.is_active });
});

app.post("/users", middlewareAuthenticateApiKey, async (req, res) => {
    const { email, planName } = req.body;
    if (!email || !planName || typeof email !== 'string' || typeof planName !== 'string' || email.trim() === '' || planName.trim() === '') {
        return res.status(400).json({ error: "Missing required fields: email, planName" });
    }
    const account = res.locals.account;
    const plan = await getPlanByName("User Plans");
    if (!plan || !plan.is_active) {
        return res.status(400).json({ error: "Plan not found" });
    }
    const subplan = await getSubplanByName(plan.id, planName);
    if (!subplan || !subplan.is_active || (subplan.created_by_account_id !== account.id && !subplan.is_system_plan)) {
        return res.status(400).json({ error: "Subplan not found" });
    }
    const newUser = await createUser({email: email, account_id: account.id, subplan_id: subplan.id});
    if (!newUser) {
        return res.status(500).json({ error: "Failed to create user" });
    }
    return res.status(201).json({ userId: newUser.id, email: newUser.email, planName: subplan.name });
});

app.post("/usage/consume", middlewareAuthenticateApiKey, async (req, res) => {
    const { userId, requestId, units } = req.body;
    if (!userId || !requestId || !units || typeof userId !== 'string' || typeof requestId !== 'string' || typeof units !== 'number' || userId.trim() === '' || requestId.trim() === '') {
        return res.status(400).json({ error: "Missing required fields: userId, requestId, units" });
    }
    if (!ensureIdIsUUID(userId) || !ensureIdIsUUID(requestId)) {
        return res.status(400).json({ error: "userId and requestId must be valid UUIDs" });
    }
    if (!Number.isFinite(units) || !Number.isInteger(units) || units <= 0) {
        return res.status(400).json({ error: "Units must be a positive integer" });
    }
    const account = res.locals.account;
    const user = await getUserAndSubplanByUserId(userId, account.id);
    if (user === undefined) {
        return res.status(404).json({ error: "User not found" });
    }
    if (!account.is_active || !user.users.is_active) {
        return res.status(403).json({ error: "Account or user is inactive" });
    }
    try {
        const result = await consumeUsage(account.id, userId, requestId, units);
        if (result){
            if (result.is_success) {
                return res.status(200).json({ success: true, unitsConsumed: result.amount });
            } else {
                return res.status(403).json({ success: false, rejectedBy: result.rejected_by, error: result.rejected_reason });
            }
        }
    } catch (error) {
        const usage = await getUsageByRequestId(requestId, account.id);
        if (usage) {
            if (usage.is_success) {
                return res.status(200).json({ success: true, unitsConsumed: usage.amount });
            } else {
                return res.status(403).json({ success: false, rejectedBy: usage.rejected_by, error: usage.rejected_reason });
            }
        }
        console.error(error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/usage/history", middlewareAuthenticateApiKey, async (req, res) => {
    const userId = req.query.userId;
    const pageParam = req.query.page;
    const limitParam = req.query.limit;
    if ((pageParam !== undefined && typeof pageParam !== 'string') || (limitParam !== undefined && typeof limitParam !== 'string')) {
        return res.status(400).json({ error: "Invalid pagination parameters" });
    }
    const page = pageParam === undefined ? 1 : Number(pageParam);
    const limit = limitParam === undefined ? 10 : Number(limitParam);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
        return res.status(400).json({ error: "page and limit must be positive integers" });
    }
    const account = res.locals.account;
    if (userId !== undefined) {
        if (typeof userId !== 'string' || userId.trim() === '') {
            return res.status(400).json({ error: "Invalid userId" });
        }
        const user = await getUserAndSubplanByUserId(userId as string, account.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        if (user.users.account_id !== account.id) {
            return res.status(403).json({ error: "User does not belong to this account" });
        }
        const userUsageHistory = await getUserUsageHistory(userId as string, account.id, limit, page);
        return res.status(200).json(userUsageHistory);
    } else {
        const accountUsageHistory = await getAccountUsageHistory(account.id, limit, page);
        return res.status(200).json(accountUsageHistory);
    }
});

app.get("/usage/summary", middlewareAuthenticateApiKey, async (req, res) => {
    const account = res.locals.account;
    const userId = req.query.userId;
    if (userId !== undefined) {
        if (typeof userId !== 'string' || userId.trim() === '') {
            return res.status(400).json({ error: "Invalid userId" });
        }
        const user = await getUserAndSubplanByUserId(userId as string, account.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        if (user.users.account_id !== account.id) {
            return res.status(403).json({ error: "User does not belong to this account" });
        }
        const summary = await getUsageSummary(account.id, userId as string);
        return res.status(200).json(summary);
    }
    return res.status(400).json({ error: "userId is required" });
});

app.patch("/accounts/me/plan", middlewareAuthenticateApiKey, async (req, res) => {
    const { planName } = req.body;
    if (!planName || typeof planName !== 'string' || planName.trim() === '') {
        return res.status(400).json({ error: "Missing required field: planName" });
    }
    const account = res.locals.account;
    const plan = await getPlanByName("Account Plans");
    if (!plan || !plan.is_active) {
        return res.status(400).json({ error: "Plan not found" });
    }
    const subplan = await getSubplanByName(plan.id, planName);
    if (!subplan || !subplan.is_active || (subplan.created_by_account_id !== account.id && !subplan.is_system_plan)) {
        return res.status(400).json({ error: "Subplan not found" });
    }
    if (account.subplan_id === subplan.id) {
        return res.status(400).json({ error: "Account is already on this plan" });
    }
    const updatedAccount = await updateAccountSubplan(account.id, subplan.id);
    if (!updatedAccount) {
        return res.status(500).json({ error: "Failed to update account plan" });
    }
    return res.status(200).json({ accountId: updatedAccount.id, accountName: updatedAccount.name, planName: subplan.name });
});

app.patch("/users/:userId/plan", middlewareAuthenticateApiKey, async (req, res) => {
    const { userId } = req.params;
    const { planName } = req.body;
    if (!planName || typeof planName !== 'string' || planName.trim() === '') {
        return res.status(400).json({ error: "Missing required field: planName" });
    }
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
        return res.status(400).json({ error: "Missing required field: userId" });
    }
    const account = res.locals.account;
    const user = await getUserAndSubplanByUserId(userId, account.id);
    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }
    if (user.users.account_id !== account.id) {
        return res.status(403).json({ error: "User does not belong to this account" });
    }
    const plan = await getPlanByName("User Plans");
    if (!plan || !plan.is_active) {
        return res.status(400).json({ error: "Plan not found" });
    }
    const subplan = await getSubplanByName(plan.id, planName);
    if (!subplan || !subplan.is_active || (subplan.created_by_account_id !== account.id && !subplan.is_system_plan)) {
        return res.status(400).json({ error: "Subplan not found" });
    }
    if (user.users.subplan_id === subplan.id) {
        return res.status(400).json({ error: "User is already on this plan" });
    }
    const updatedUser = await updateUserSubplan(userId, account.id, subplan.id);
    if (!updatedUser) {
        return res.status(500).json({ error: "Failed to update user plan" });
    }
    return res.status(200).json({ userId: updatedUser.id, email: updatedUser.email, planName: subplan.name });
});

app.get("/plans/:planId/subplans", middlewareAuthenticateApiKey, async (req, res) => {
    const planId = req.params.planId;
    if (!planId || typeof planId !== 'string' || planId.trim() === '') {
        return res.status(400).json({ error: "Missing required field: planId" });
    }
    const plan = await getPlanById(planId);
    if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
    }
    const subplans = await getSubplansByPlanId(planId, res.locals.account.id);
    return res.status(200).json(subplans);
});

app.post("/plans/:planId/subplans", middlewareAuthenticateApiKey, async (req, res) => {
    const planId = req.params.planId;
    if (!planId || typeof planId !== 'string' || planId.trim() === '') {
        return res.status(400).json({ error: "Missing required field: planId" });
    }
    const { name, description, price, monthly_limit, max_request_limit } = req.body;
    if (name === undefined || description === undefined || price === undefined || monthly_limit === undefined || max_request_limit === undefined) {
        return res.status(400).json({ error: "Missing required fields: name, description, price, monthly_limit, max_request_limit" });
    }
    if (typeof name !== "string" || name.trim() === "" || typeof description !== "string" || description.trim() === "" || typeof price !== "string" || !/^\d{1,8}(\.\d{1,2})?$/.test(price) || typeof monthly_limit !== "number" || !Number.isFinite(monthly_limit) || !Number.isInteger(monthly_limit) || monthly_limit < 0 || typeof max_request_limit !== "number" || !Number.isFinite(max_request_limit) || !Number.isInteger(max_request_limit) || max_request_limit < 0) {
        return res.status(400).json({ error: "Invalid field types or values" });
    }
    const plan = await getPlanById(planId);
    if (!plan || !plan.is_active) {
        return res.status(404).json({ error: "Plan not found" });
    }
    const account = res.locals.account;
    const newSubplan = await createSubplan({ plan_id: planId, name, description, price, monthly_limit, max_request_limit, created_by_account_id: account.id });
    if (!newSubplan) {
        return res.status(500).json({ error: "Failed to create subplan" });
    }
    return res.status(201).json(newSubplan);
});

app.patch("/plans/:planId/subplans/:subplanId", middlewareAuthenticateApiKey, async (req, res) => {
    const planId = req.params.planId;
    if (!planId || typeof planId !== 'string' || planId.trim() === '') {
        return res.status(400).json({ error: "Missing required field: planId" });
    }
    const subplanId = req.params.subplanId;
    if (!subplanId || typeof subplanId !== 'string' || subplanId.trim() === '') {
        return res.status(400).json({ error: "Missing required field: subplanId" });
    }
    const { name, description, price, monthly_limit, max_request_limit, is_active } = req.body;
    if (name === undefined && description === undefined && price === undefined && monthly_limit === undefined && max_request_limit === undefined && is_active === undefined) {
        return res.status(400).json({ error: "At least one field must be provided for update" });
    }
    if ((name !== undefined && (typeof name !== "string" || name.trim() === "")) || (description !== undefined && (typeof description !== "string" || description.trim() === "")) || (price !== undefined && (typeof price !== "string" || !/^\d{1,8}(\.\d{1,2})?$/.test(price))) || (monthly_limit !== undefined && (typeof monthly_limit !== "number" || !Number.isFinite(monthly_limit) || !Number.isInteger(monthly_limit) || monthly_limit < 0)) || (max_request_limit !== undefined && (typeof max_request_limit !== "number" || !Number.isFinite(max_request_limit) || !Number.isInteger(max_request_limit) || max_request_limit < 0)) || (is_active !== undefined && typeof is_active !== "boolean")) {
        return res.status(400).json({ error: "Invalid field types" });
    }
    const plan = await getPlanById(planId);
    if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
    }
    const subplan = await getSubplanById(subplanId);
    if (!subplan || subplan.id !== subplanId) {
        return res.status(404).json({ error: "Subplan not found" });
    }
    if (subplan.plan_id !== planId) {
        return res.status(400).json({ error: "Subplan does not belong to the specified plan" });
    }
    const account = res.locals.account;
    if (subplan.created_by_account_id !== account.id) {
        return res.status(403).json({ error: "You do not have permission to update this subplan" });
    }
    const updatedSubplan = await updateSubplan(subplanId, { name, description, price, monthly_limit, max_request_limit, is_active });
    if (!updatedSubplan) {
        return res.status(500).json({ error: "Failed to update subplan" });
    }
    return res.status(200).json(updatedSubplan);
});

app.get("/plans", middlewareAuthenticateApiKey, async (req, res) => {
    const account = res.locals.account;
    const accountPlan = await getPlanByName("Account Plans");
    const userPlan = await getPlanByName("User Plans");
    if (!accountPlan || !userPlan) {
        return res.status(500).json({ error: "Failed to retrieve plans" });
    }
    const accountPlans = await getSubplansByPlanId(accountPlan.id, account.id);
    const userPlans = await getSubplansByPlanId(userPlan.id, account.id);
    return res.status(200).json({ accountPlans, userPlans });
});

app.get("/health", async (req, res) => {
    try {
        await db.select().from(plans).limit(1);
        return res.status(200).json({ status: "ok", database: "connected" });
    } catch (error) {
        console.error(error);
        return res.status(503).json({ status: "error", database: "disconnected" });
    }
});

// Start the server only if this file is run directly, not when imported
if (require.main === module) {
    app.listen(port, '0.0.0.0', () => {
        console.log("Usage Metering Service is running!");
    });
}

export default app;