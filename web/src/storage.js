/* =========================================================================
   storage.js — прогресс + настройки.
   Сейчас: localStorage (мгновенно). Точка расширения для Этапа 4 —
   синхронизация с бэкендом (см. syncPush/syncPull ниже).
   ========================================================================= */

const KEY = "madinawords_v1";

const DEFAULT_SETTINGS = { dir: "ar", number: "sing", theme: "light" };

/** Единое состояние приложения. cards: id -> SRS-состояние. */
export const APP = {
  cards: {},
  settings: { ...DEFAULT_SETTINGS },
};

let saveTimer = null;

/** Загрузка из localStorage (позже — merge с бэкендом). */
export async function loadApp() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      APP.cards = p.cards || {};
      APP.settings = { ...DEFAULT_SETTINGS, ...(p.settings || {}) };
    }
  } catch (e) {
    console.warn("[storage] load failed", e);
  }
  // await syncPull();  // ← Этап 4: подтянуть с сервера и смёржить
}

/** Сохранение (дебаунс, чтобы не писать на каждый клик). */
export function saveApp() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(APP));
    } catch (e) {
      console.warn("[storage] save failed", e);
    }
    // syncPush();  // ← Этап 4: отправить дельту на сервер
  }, 250);
}

/** Полный сброс прогресса (настройки сохраняются). */
export function resetProgress() {
  APP.cards = {};
  saveApp();
}

/* ---------- Этап 4: заглушки синхронизации с бэкендом ----------
   Реализуются, когда появится Fastify API. Интерфейс намеренно простой:
   GET /api/progress → {settings, cards}; PUT /api/progress ← дельта.
export async function syncPull() { ... }
export async function syncPush() { ... }
*/
