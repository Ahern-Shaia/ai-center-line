import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

const port = Number(process.env.PORT ?? 3000);
const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

// CORS：dev 同源不需要，prod 前後端不同 subdomain 必開。
// 用 Fastify 原生 onRequest hook 手寫，避免拉 @fastify/cors 或 @fastify/middie（0 新 dep）。
// CORS_ORIGINS = comma-separated 白名單（`https://xxx.onrender.com,https://warroom.aiproot.com`）
// 空值 = 全跳過（等同 dev 同源）
const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (corsOrigins.length) {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && corsOrigins.includes(origin)) {
      void reply.header("Access-Control-Allow-Origin", origin);
      void reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      void reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      void reply.header("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });
  console.log(`[server] CORS allowed: ${corsOrigins.join(", ")}`);
}

await app.listen({ port, host: "0.0.0.0" });
console.log(`[server] listening on :${port}`);
