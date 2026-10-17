import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";
import { config } from "../config.js";

const conn = postgres(config.db.url);
export const db = drizzle(conn, { schema });

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const closeDb = async () => {
    await conn.end();
};