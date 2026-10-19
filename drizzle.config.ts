import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";

const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";

if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
}

export default defineConfig({
    schema: "src/db/schema.ts",
    out: "src/db/migrations",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DB_URL!,
    },
});