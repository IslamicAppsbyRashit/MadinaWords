/* =========================================================================
   routes/progress.js — API синхронизации прогресса.
   Все маршруты требуют валидной Telegram initData (preHandler ниже).
   ========================================================================= */
import { validateInitData, extractInitData } from "../auth.js";
import { ensureUser, getState, saveState, clearProgress } from "../db.js";

const putSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    properties: {
      settings: { type: "object", additionalProperties: true },
      cards: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: { score: { type: "integer", enum: [0, 1, 2] } },
          required: ["score"],
          additionalProperties: false,
        },
      },
    },
  },
};

export default async function progressRoutes(fastify, opts) {
  const { botToken, maxAge } = opts;

  // авторизация: проверяем подпись initData на каждом запросе к /api/progress
  fastify.addHook("preHandler", async (req, reply) => {
    const initData = extractInitData(req);
    const user = validateInitData(initData, botToken, maxAge);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized", message: "Неверная или отсутствующая Telegram initData" });
    }
    req.tgUser = user;
  });

  // отдать всё состояние пользователя
  fastify.get("/api/progress", async (req) => {
    ensureUser(req.tgUser);
    return getState(req.tgUser.id);
  });

  // принять дельту изменений (настройки и/или карточки)
  fastify.put("/api/progress", { schema: putSchema }, async (req) => {
    ensureUser(req.tgUser);
    saveState(req.tgUser.id, req.body || {});
    return { ok: true };
  });

  // сброс всего прогресса пользователя (настройки сохраняются)
  fastify.delete("/api/progress", async (req) => {
    ensureUser(req.tgUser);
    clearProgress(req.tgUser.id);
    return { ok: true };
  });
}
