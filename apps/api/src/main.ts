import "reflect-metadata";
import "./env.js";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./modules/app.module.js";

const port = Number(process.env.PORT ?? 4317);
const apiToken = process.env.SP_AGENT_API_TOKEN;
const allowedOrigin = process.env.SP_AGENT_RENDERER_ORIGIN;
const developmentRendererOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/u;
type LocalRequest = { headers: { authorization?: string } };
type LocalResponse = { status(code: number): { json(value: unknown): void } };
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  cors: {
    // Electron supplies one exact renderer origin. Browser development uses a
    // local Vite origin, while production without a renderer origin stays closed.
    origin: allowedOrigin ? [allowedOrigin] : process.env.NODE_ENV !== "production" ? developmentRendererOrigin : false,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", "authorization"],
    maxAge: 600
  }
});
app.useBodyParser("json", { limit: process.env.API_JSON_BODY_LIMIT ?? "25mb" });
app.useBodyParser("urlencoded", { limit: process.env.API_JSON_BODY_LIMIT ?? "25mb", extended: true });
app.use((request: LocalRequest, response: LocalResponse, next: () => void) => {
  if (!apiToken) return next();
  if (request.headers.authorization === `Bearer ${apiToken}`) return next();
  response.status(401).json({ statusCode: 401, message: "Local API authentication is required." });
});
app.setGlobalPrefix("api");
await app.listen(port, "127.0.0.1");

console.log(`sp-agent API listening on http://127.0.0.1:${port}/api${apiToken ? " with bearer authentication" : " (development authentication disabled)"}`);
