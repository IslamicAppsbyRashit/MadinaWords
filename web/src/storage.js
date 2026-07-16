/* =========================================================================
   storage.js — прогресс + настройки, offline-first с синхронизацией.

   Модель:
   - localStorage — мгновенное локальное хранилище (работает офлайн).
   - Сервер (/api/progress) — общий прогресс между устройствами.
   - Стратегия: «сервер-авторитетный pull + локальный outbox».

   Надёжность (аудит silent-failure):
   - все обращения к серверу сериализованы (pushNow и syncPull не пересекаются) —
     нет гонок, теряющих данные или воскрешающих сброшенный прогресс;
   - ошибки классифицируются: 401 (нужна переавторизация) и 4xx (сервер отклонил
     данные) не ретраятся бесконечно и сообщаются пользователю; сеть/5xx/таймаут —
     ретрай с нарастающей задержкой;
   - из outbox вычёркиваются только реально отправленные ключи;
   - сбои localStorage/очереди не проглатываются молча.
   ========================================================================= */
import { tgInitData } from "./telegram.js";
import * as api from "./api.js";

const KEY = "madinawords_v1";
const CORRUPT_KEY = KEY + ".corrupt";
const OUTBOX_KEY = "madinawords_outbox_v1";
const RESET_KEY = "madinawords_reset_pending";
export const SETTINGS_MARK = "__settings__";

const PUSH_DEBOUNCE = 1200;
const MAX_BACKOFF = 60000;

const DEFAULT_SETTINGS = { dir: "ar", number: "sing", theme: "light" };
const isTelegram = () => !!tgInitData();

/** Единое состояние приложения. cards: id -> {score}. */
export const APP = {
  cards: {},
  settings: { ...DEFAULT_SETTINGS },
};

let saveTimer = null;
let pushTimer = null;
let pushBackoff = PUSH_DEBOUNCE;
let persistBroken = false;
let loadWasCorrupt = false;
let persistErrorHandler = null;
let syncErrorHandler = null;
let syncErrorState = null;
let syncedHandler = null;

let outbox = new Set();   // id карточек + SETTINGS_MARK, ещё не отправленные
let pendingReset = false; // сброс, не доехавший до сервера

/* сериализация синка: pushNow и syncPull идут строго по очереди */
let syncChain = Promise.resolve();
function runExclusive(fn) {
  const p = syncChain.then(fn, fn);
  syncChain = p.then(() => {}, () => {});
  return p;
}

/* ---------- уведомления UI ---------- */
export function onPersistError(cb) {
  persistErrorHandler = cb;
  if (persistBroken || loadWasCorrupt) cb({ persistBroken, loadWasCorrupt });
}
export const isPersistBroken = () => persistBroken;
function notifyPersistError() {
  try { persistErrorHandler?.({ persistBroken, loadWasCorrupt }); }
  catch (e) { console.error("[storage] onPersistError handler", e); }
}
/** Колбэк со статусом синхронизации: "auth" | "rejected" | "local" | null (ок). */
export function onSyncError(cb) {
  syncErrorHandler = cb;
  if (syncErrorState) cb(syncErrorState);
}
function setSyncError(kind) {
  syncErrorState = kind;
  try { syncErrorHandler?.(kind); } catch (e) { console.error("[storage] onSyncError handler", e); }
}
function clearSyncError() {
  if (!syncErrorState) return;
  syncErrorState = null;
  try { syncErrorHandler?.(null); } catch (e) { console.error("[storage] onSyncError handler", e); }
}
/** Колбэк, который перерисует UI после прихода серверного состояния. */
export function onSynced(cb) { syncedHandler = cb; }

/* ---------- локальное хранилище ---------- */
function persistLocal() {
  if (persistBroken) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(APP));
  } catch (e) {
    console.error("[storage] не удалось сохранить прогресс локально", e);
    persistBroken = true;
    notifyPersistError();
  }
}
function saveOutbox() {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([...outbox]));
    localStorage.setItem(RESET_KEY, pendingReset ? "1" : "");
  } catch (e) {
    // очередь синка не сохранилась — при перезагрузке потеряется необходимость досинка
    console.error("[storage] не удалось сохранить очередь синхронизации", e);
    setSyncError("local");
  }
}
function loadOutbox() {
  try {
    outbox = new Set(JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]"));
    pendingReset = localStorage.getItem(RESET_KEY) === "1";
  } catch (e) {
    console.error("[storage] повреждённая очередь синхронизации, сбрасываю", e);
    outbox = new Set();
    pendingReset = false;
  }
}

/* ---------- загрузка ---------- */
export async function loadApp() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    loadOutbox();
  } catch (e) {
    console.error("[storage] localStorage недоступен при загрузке", e);
    persistBroken = true;
    return;
  }
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    APP.cards = p.cards || {};
    APP.settings = { ...DEFAULT_SETTINGS, ...(p.settings || {}) };
  } catch (e) {
    console.error("[storage] повреждённые данные, копия сохранена в", CORRUPT_KEY, e);
    try { localStorage.setItem(CORRUPT_KEY, raw); } catch {}
    loadWasCorrupt = true;
    persistBroken = true; // не перезаписывать оригинал до решения пользователя
    notifyPersistError();
  }
}

/* ---------- сохранение изменения ---------- */
/**
 * @param {string|string[]} [dirty] что изменилось: id карточки(ек) или SETTINGS_MARK.
 * Кладёт в outbox, пишет локально и планирует отправку на сервер.
 */
export function saveApp(dirty) {
  if (dirty != null) {
    for (const d of Array.isArray(dirty) ? dirty : [dirty]) outbox.add(d);
    saveOutbox();
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistLocal, 250);
  pushBackoff = PUSH_DEBOUNCE; // новая активность — вернуть обычную частоту синка
  schedulePush();
}

/* ---------- сброс прогресса ---------- */
export function resetProgress() {
  APP.cards = {};
  outbox.clear();
  loadWasCorrupt = false;
  persistBroken = false;
  pendingReset = true; // сообщить серверу; если офлайн — уйдёт позже
  try { localStorage.removeItem(CORRUPT_KEY); } catch {}
  saveOutbox();
  persistLocal();
  schedulePush();
}

/* ---------- синхронизация ---------- */
function schedulePush(delay = PUSH_DEBOUNCE) {
  if (!isTelegram()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => runExclusive(pushNow), delay);
}

async function pushNow() {
  if (!isTelegram()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) { schedulePush(pushBackoff); return; }
  if (!pendingReset && outbox.size === 0) return;

  const sent = new Set(); // ключи, реально отправленные в этот раз
  try {
    if (pendingReset) {
      await api.deleteProgress();
      pendingReset = false;
      saveOutbox();
    }
    if (outbox.size) {
      const snap = new Set(outbox);
      const payload = { cards: {} };
      let withSettings = false;
      for (const k of snap) {
        if (k === SETTINGS_MARK) { withSettings = true; sent.add(k); }
        else if (APP.cards[k]) { payload.cards[k] = APP.cards[k]; sent.add(k); }
        else { console.warn("[sync] в outbox ключ без данных, убираю:", k); outbox.delete(k); }
      }
      if (withSettings) payload.settings = APP.settings;
      if (sent.size) {
        await api.putProgress(payload);
        for (const k of sent) outbox.delete(k); // только отправленное; новое за время запроса остаётся
      }
      saveOutbox();
    }
    pushBackoff = PUSH_DEBOUNCE;
    clearSyncError();
    if (outbox.size) schedulePush(); // накопилось новое
  } catch (e) {
    handleSyncFailure(e, sent);
  }
}

function handleSyncFailure(e, sent) {
  const status = e.status;
  if (status === 401) {
    // initData протухла — бесконечно долбить сервер бессмысленно; сообщаем пользователю
    console.error("[sync] авторизация отклонена (401). Прогресс сохраняется локально.", e);
    setSyncError("auth");
    return;
  }
  if (status >= 400 && status < 500) {
    // сервер счёл данные некорректными — убираем «ядовитые» ключи, чтобы не блокировать очередь
    console.error(`[sync] сервер отклонил данные (${status}), исключаю их из очереди`, e);
    for (const k of sent) outbox.delete(k);
    saveOutbox();
    setSyncError("rejected");
    if (outbox.size) schedulePush();
    return;
  }
  // сеть / 5xx / таймаут — временно; повтор с нарастающей задержкой
  console.warn(`[sync] временный сбой (${e.timeout ? "таймаут" : status || e.message}), повтор позже`);
  pushBackoff = Math.min(pushBackoff * 2, MAX_BACKOFF);
  schedulePush(pushBackoff);
}

/** Подтянуть серверное состояние и смёржить (сервер + свои несинхр. изменения). */
export function syncPull() {
  if (!isTelegram()) return Promise.resolve();
  return runExclusive(async () => {
    try {
      if (pendingReset) { await api.deleteProgress(); pendingReset = false; saveOutbox(); }

      const server = await api.getProgress();

      // Пользователь мог сбросить прогресс, пока летел GET — не воскрешаем удалённое.
      if (pendingReset) {
        console.warn("[sync] сброс во время загрузки — игнорирую серверные данные");
        schedulePush();
        return;
      }

      const mergedCards = { ...(server.cards || {}) };
      for (const id of outbox) {
        if (id !== SETTINGS_MARK && APP.cards[id]) mergedCards[id] = APP.cards[id]; // свои несинхр. правки поверх
      }
      APP.cards = mergedCards;

      if (!outbox.has(SETTINGS_MARK) && server.settings) {
        APP.settings = { ...DEFAULT_SETTINGS, ...server.settings };
      }

      persistLocal();
      clearSyncError();
      try { syncedHandler?.(); } catch (e) { console.error("[sync] onSynced handler", e); }
      if (outbox.size) schedulePush(); // догнать сервер своими правками
    } catch (e) {
      if (e.status === 401) { console.error("[sync] 401 при загрузке — нужна переавторизация", e); setSyncError("auth"); }
      else console.warn(`[sync] загрузка с сервера не удалась (${e.timeout ? "таймаут" : e.status || e.message})`);
    }
  });
}

/* восстановление сети — дослать накопленное */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { pushBackoff = PUSH_DEBOUNCE; schedulePush(); });
}
