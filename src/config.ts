import { existsSync } from "node:fs";

const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";

if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
}

type APIConfig = {
    port: number;
    platform: string;
};

function envOrThrow(key: string): string{
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing environment variable: ${key}`);
    }
    return value;
}

type DBConfig = {
    url: string;
};

export const config = {
    api: {
        fileserverHits: 0,
        port: Number(envOrThrow("PORT")),
        platform: envOrThrow("PLATFORM"),
    },
    db: {
        url: envOrThrow("DB_URL"),
    }
};