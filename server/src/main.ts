import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

const port = Number(process.env.PORT ?? 3000);
const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
await app.listen({ port, host: "0.0.0.0" });
console.log(`[server] listening on :${port}`);
