/* =========================================================================
   index.js — точка входа бэкенда MadinaWords.
   Fastify: авторизация Telegram initData, синхронизация прогресса,
   раздача собранного фронтенда (web/dist) для единого деплоя.
   ========================================================================= */
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import progressRoutes from "./routes/progress.js";
import db from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env (Node 22+) — не обязателен в проде, если переменные заданы иначе
const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envPath);
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const INITDATA_MAX_AGE = Number(process.env.INITDATA_MAX_AGE ?? 86400);

if (!BOT_TOKEN) {
  console.error("✗ BOT_TOKEN не задан. Скопируй server/.env.example → server/.env и впиши токен из @BotFather.");
  process.exit(1);
}
if (!Number.isFinite(PORT)) {
  console.error(`✗ Некорректный PORT: ${process.env.PORT}`);
  process.exit(1);
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });

// CORS: разрешаем кросс-домен для разработки (фронт на vite:5174).
// Безопасно: авторизация идёт по подписанной initData, а не по кукам.
await app.register(fastifyCors, { origin: true });

await app.register(progressRoutes, { botToken: BOT_TOKEN, maxAge: INITDATA_MAX_AGE });

app.get("/api/health", async () => ({ ok: true, ts: Date.now() }));

// Раздача собранного фронтенда (если есть). Для локальной разработки фронт
// обычно поднимается отдельно через `npm run dev` в web/.
const distDir = resolve(__dirname, "..", "..", "web", "dist");
if (existsSync(distDir)) {
  await app.register(fastifyStatic, { root: distDir, prefix: "/" });
  app.log.info(`Статика фронтенда: ${distDir}`);
} else {
  app.log.warn(`web/dist не найден — фронтенд не раздаётся. Собери его: cd web && npm run build`);
}

// корректное завершение: закрыть HTTP и БД по сигналу (важно при редеплое)
const shutdown = async (signal) => {
  app.log.info(`${signal} — останавливаюсь...`);
  try {
    await app.close();
    db.close();
    app.log.info("остановлен чисто");
    process.exit(0);
  } catch (e) {
    app.log.error(e, "ошибка при остановке");
    process.exit(1);
  }
};
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => shutdown(sig));

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
