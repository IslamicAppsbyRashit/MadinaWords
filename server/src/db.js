/* =========================================================================
   db.js — SQLite (better-sqlite3). Хранит пользователей и их прогресс.
   Сам словарь в БД не лежит — он статичен (web/public/cards.json).
   ========================================================================= */
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || resolve(__dirname, "..", "madinawords.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // конкурентные чтения + быстрые записи
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id       INTEGER PRIMARY KEY,
    first_name  TEXT,
    username    TEXT,
    settings    TEXT,             -- JSON: {dir, number, theme}
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS progress (
    tg_id       INTEGER NOT NULL,
    card_id     TEXT    NOT NULL, -- стабильный id из cards.json, напр. "L1-3"
    score       INTEGER NOT NULL, -- 0=слабых, 1=к повтору, 2=изучено
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (tg_id, card_id),
    FOREIGN KEY (tg_id) REFERENCES users(tg_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_progress_tg ON progress(tg_id);
`);

/* ---------- prepared statements ---------- */
const stmt = {
  upsertUser: db.prepare(`
    INSERT INTO users (tg_id, first_name, username, settings, created_at, updated_at)
    VALUES (@tg_id, @first_name, @username, @settings, @now, @now)
    ON CONFLICT(tg_id) DO UPDATE SET
      first_name = excluded.first_name,
      username   = excluded.username,
      updated_at = excluded.updated_at
  `),
  setSettings: db.prepare(`UPDATE users SET settings = @settings, updated_at = @now WHERE tg_id = @tg_id`),
  getUser: db.prepare(`SELECT * FROM users WHERE tg_id = ?`),
  getProgress: db.prepare(`SELECT card_id, score FROM progress WHERE tg_id = ?`),
  upsertProgress: db.prepare(`
    INSERT INTO progress (tg_id, card_id, score, updated_at)
    VALUES (@tg_id, @card_id, @score, @now)
    ON CONFLICT(tg_id, card_id) DO UPDATE SET
      score = excluded.score,
      updated_at = excluded.updated_at
  `),
  clearProgress: db.prepare(`DELETE FROM progress WHERE tg_id = ?`),
};

/** Убедиться, что пользователь есть; обновить имя/username при каждом визите. */
export function ensureUser(user) {
  stmt.upsertUser.run({
    tg_id: user.id,
    first_name: user.first_name ?? null,
    username: user.username ?? null,
    settings: null, // не перетираем настройки существующего пользователя
    now: Date.now(),
  });
}

/** Прочитать всё состояние пользователя: {settings, cards:{id:{score}}}. */
export function getState(tgId) {
  const u = stmt.getUser.get(tgId);
  const rows = stmt.getProgress.all(tgId);
  const cards = {};
  for (const r of rows) cards[r.card_id] = { score: r.score };

  // Битый settings НЕ должен ронять весь ответ — карточки важнее.
  let settings = null;
  if (u?.settings) {
    try {
      settings = JSON.parse(u.settings);
    } catch (e) {
      console.error(`[db] повреждённые settings у tg_id=${tgId}, возвращаю null`, e.message);
    }
  }
  return { settings, cards };
}

/** Удалить весь прогресс пользователя (настройки сохраняются). */
export function clearProgress(tgId) {
  stmt.clearProgress.run(tgId);
}

/** Сохранить дельту: настройки и/или карточки (last-write-wins по карточке). */
export const saveState = db.transaction((tgId, { settings, cards }) => {
  const now = Date.now();
  if (settings && typeof settings === "object") {
    stmt.setSettings.run({ tg_id: tgId, settings: JSON.stringify(settings), now });
  }
  if (cards && typeof cards === "object") {
    for (const [card_id, v] of Object.entries(cards)) {
      // Через HTTP это недостижимо (JSON-схема маршрута отклоняет весь запрос 400),
      // защита нужна для прямых вызовов/тестов, а не для partial-apply по сети.
      const score = Number(v?.score);
      if (![0, 1, 2].includes(score)) {
        console.warn(`[db] пропущена карточка с некорректным баллом: ${card_id}=${v?.score} (tg_id=${tgId})`);
        continue;
      }
      stmt.upsertProgress.run({ tg_id: tgId, card_id, score, now });
    }
  }
});

export default db;
