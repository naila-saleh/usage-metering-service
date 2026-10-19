import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { consumeUsage } from "./usage-service";
import { db } from "../db";
import { getUsageByRequestId, createUsage, setUsageSuccess, getMonthlyAccountUsage, getMonthlyUserUsage,} from "../db/queries/usages";
import { getAccountAndSubplanByAccountId } from "../db/queries/accounts";
import { getUserAndSubplanByUserId } from "../db/queries/users";

vi.mock("../db", () => ({
    db: { transaction: vi.fn() },
}));

vi.mock("../db/queries/usages", () => ({
    getUsageByRequestId: vi.fn(),
    createUsage: vi.fn(),
    setUsageSuccess: vi.fn(),
    getMonthlyAccountUsage: vi.fn(),
    getMonthlyUserUsage: vi.fn(),
}));

vi.mock("../db/queries/accounts", () => ({
    getAccountAndSubplanByAccountId: vi.fn(),
}));

vi.mock("../db/queries/users", () => ({
    getUserAndSubplanByUserId: vi.fn(),
}));

const account = {
    accounts: {
        is_active: true,
        subscription_started_at: new Date("2026-01-15T00:00:00Z"),
    },
    subplans: {
        is_active: true,
        monthly_limit: 100,
        max_request_limit: 10,
    },
};

const user = {
    users: {
        is_active: true,
        subscription_started_at: new Date("2026-01-15T00:00:00Z"),
    },
    subplans: {
        is_active: true,
        monthly_limit: 100,
        max_request_limit: 10,
    },
};

const successfulUsage = {
    id: "usage-1",
    request_id: "request-1",
    account_id: "account-1",
    user_id: "user-1",
    amount: 1,
    is_success: true,
    rejected_by: "",
    rejected_reason: "",
};

const rejectedUsage = {
    ...successfulUsage,
    is_success: false,
    rejected_by: "account",
    rejected_reason: "Account monthly limit exceeded",
};

beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(db.transaction).mockImplementation(
        async (callback) => callback({} as never),
    );

    vi.mocked(getUsageByRequestId).mockResolvedValue(undefined);
    vi.mocked(getAccountAndSubplanByAccountId).mockResolvedValue(account as never);
    vi.mocked(getUserAndSubplanByUserId).mockResolvedValue(user as never);
    vi.mocked(getMonthlyAccountUsage).mockResolvedValue(0);
    vi.mocked(getMonthlyUserUsage).mockResolvedValue(0);
    vi.mocked(createUsage).mockResolvedValue({ ...successfulUsage, is_success: false } as never);
    vi.mocked(setUsageSuccess).mockResolvedValue(successfulUsage as never);
});

describe("consumeUsage", () => {
    it("does not create a duplicate for an existing successful request", async () => {
        vi.mocked(getUsageByRequestId)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(successfulUsage as never);

        const firstResult = await consumeUsage(
            "account-1", "user-1", "request-1", 1,
        );

        const secondResult = await consumeUsage(
            "account-1", "user-1", "request-1", 1,
        );

        expect(firstResult).toEqual(successfulUsage);
        expect(secondResult).toEqual(successfulUsage);
        expect(createUsage).toHaveBeenCalledTimes(1);
    });

    it("does not create a duplicate for an existing rejected request", async () => {
        vi.mocked(getUsageByRequestId)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(rejectedUsage as never)
            .mockResolvedValueOnce(rejectedUsage as never);

        vi.mocked(getMonthlyAccountUsage).mockResolvedValue(100);

        await expect(
            consumeUsage("account-1", "user-1", "request-1", 1),
        ).rejects.toThrow("has exceeded its monthly limit");

        await expect(
            consumeUsage("account-1", "user-1", "request-1", 1),
        ).rejects.toThrow("Account monthly limit exceeded");

        expect(createUsage).toHaveBeenCalledTimes(1);
    });

    it("rejects a request that exceeds the account's max request limit", async () => {
        vi.mocked(getUsageByRequestId)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined);

        await expect(
            consumeUsage("account-1", "user-1", "request-1", 11),
        ).rejects.toThrow("exceeds the maximum request limit for account");

        expect(createUsage).toHaveBeenCalledTimes(1);
    });

    it("uses UTC calendar month boundaries for quota checks", async () => {
        vi.mocked(getUsageByRequestId)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined);

        vi.useFakeTimers({ now: new Date("2026-10-31T23:30:00.000Z") });

        await consumeUsage("account-1", "user-1", "request-2", 1);

        expect(getMonthlyAccountUsage).toHaveBeenCalledWith(
            "account-1",
            new Date("2026-10-01T00:00:00.000Z"),
            new Date("2026-11-01T00:00:00.000Z"),
            expect.anything(),
        );

        expect(getMonthlyUserUsage).toHaveBeenCalledWith(
            "user-1",
            "account-1",
            new Date("2026-10-01T00:00:00.000Z"),
            new Date("2026-11-01T00:00:00.000Z"),
            expect.anything(),
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });
});