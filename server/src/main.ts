import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import fastifyCors from "@fastify/cors";
import { AppModule } from "./app.module.js";

const port = Number(process.env.PORT ?? 3000);
const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

// CORS：dev 同源不需要，prod 前後端不同 subdomain 必開。
// CORS_ORIGINS = comma-separated 白名單（`https://xxx.onrender.com,https://warroom.aiproot.com`）
// 空值 = 拒絕跨域（等同 disabled）
const origins = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (origins.length) {
  await app.register(fastifyCors, {
    origin: origins,
    credentials: false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });
  console.log(`[server] CORS allowed: ${origins.join(", ")}`);
}

await app.listen({ port, host: "0.0.0.0" });
console.log(`[server] listening on :${port}`);
