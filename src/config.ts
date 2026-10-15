
process.loadEnvFile()

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