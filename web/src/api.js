/* =========================================================================
   api.js — клиент бэкенда. Авторизация по подписанной Telegram initData.
   В проде фронт и API на одном домене (сервер раздаёт статику), поэтому
   пути абсолютные: /api/*. В dev — проксируются Vite на localhost:3000.
   ========================================================================= */
import { tgInitData } from "./telegram.js";

const TIMEOUT_MS = 12000; // зависшая сеть не должна клинить синхронизацию навсегда

async function request(method, path, body) {
  const headers = { Authorization: "tma " + tgInitData() };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") {
      const err = new Error(`API ${method} ${path} → таймаут ${TIMEOUT_MS}мс`);
      err.timeout = true;
      throw err;
    }
    throw e; // сетевая ошибка (нет соединения) — ретраится вызывающим кодом
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const err = new Error(`API ${method} ${path} → ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/** → { settings, cards: {id:{score}} } */
export const getProgress = () => request("GET", "/progress");

/** delta: { settings?, cards?: {id:{score}} } → { ok:true } */
export const putProgress = (delta) => request("PUT", "/progress", delta);

/** Полный сброс прогресса пользователя на сервере. */
export const deleteProgress = () => request("DELETE", "/progress");
