import express from "express";

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

app.listen(3000, '0.0.0.0', () => {
    console.log("Usage Metering Service is running!");
});