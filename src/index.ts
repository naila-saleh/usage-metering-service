import express from "express";
import { config } from './config.js';
import { db } from "./db/index.js";
import { plans } from "./db/schema.js";

const app = express();

app.use(express.json());

app.get("/health", async (req, res) => {
    try {
        await db.select().from(plans).limit(1);
        res.status(200).json({ status: "ok", database: "connected" });
    } catch (error) {
        console.error(error);
        res.status(503).json({ status: "error", database: "disconnected" });
    }
});

app.listen(3000, '0.0.0.0', () => {
    console.log("Usage Metering Service is running!");
});