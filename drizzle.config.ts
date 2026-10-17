import { defineConfig } from "drizzle-kit";
process.loadEnvFile(
    process.env.NODE_ENV === "test" ? ".env.test" : ".env"
);

export default defineConfig({
    schema: "src/db/schema.ts",
    out: "src/db/migrations",
    dialect: "postgresql",
    dbCredentials: {
        url: process.env.DB_URL!,
    },
});