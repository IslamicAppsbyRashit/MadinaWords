#!/usr/bin/env node
/**
 * build-dict.mjs — собирает cards.json из нескольких книг словаря.
 *
 * Источник книг — dictionary/manifest.json:
 *   { "books": [ { "id":1, "title":"Том 1", "titleAr":"…", "file":"…​.md" }, … ] }
 * Чтобы добавить книгу — положи новый .md в dictionary/ и допиши запись в manifest.
 *
 * Формат таблиц в каждом .md (может быть несколько таблиц на урок):
 *   3 колонки: | Перевод | Единственное число            | Множественное число |
 *   4 колонки: | Перевод | Ед. число (м.р.) | Ед. число (ж.р.) | Множественное число |
 *
 * Особенности: пропуски уроков (нумерация не сплошная), «—» = нет формы,
 * варианты «سُرُرٌ / أَسِرَّةٌ» сохраняются строкой.
 *
 * Стабильные id: b{книга}-l{урок}-{n}. При дополнении словаря НОВЫЕ слова
 * добавляй в КОНЕЦ урока — тогда id ранее выученных слов не сдвигаются и
 * прогресс не сбивается.
 *
 * Запуск:  node scripts/build-dict.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DICT_DIR = resolve(ROOT, "dictionary");
const MANIFEST = resolve(DICT_DIR, "manifest.json");
const OUT = resolve(ROOT, "web/public/cards.json");

const EMPTY = new Set(["—", "-", "–", "", "—/—"]);
const cell = (raw) => {
  const v = (raw ?? "").trim();
  return EMPTY.has(v) ? null : v;
};
function splitRow(line) {
  const parts = line.split("|");
  if (parts.length && parts[0].trim() === "") parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
  return parts.map((p) => p.trim());
}
const isSeparator = (line) => /^\|?\s*:?-{2,}/.test(line.trim());
const isTableRow = (line) => line.trim().startsWith("|");
const isHeader = (cells) => cells[0] && /перевод/i.test(cells[0]);

/** Разобрать одну книгу → {cards:[...], lessons:[{n,count}]}. */
function parseBook(bookId, filePath) {
  const md = readFileSync(filePath, "utf8");
  const lines = md.split(/\r?\n/);
  const cards = [];
  const lessonCounts = new Map();
  let lesson = null, layout = null, inTable = false;

  for (const line of lines) {
    const lm = line.match(/^##\s*Урок\s+(\d+)/i);
    if (lm) {
      lesson = Number(lm[1]);
      if (!lessonCounts.has(lesson)) lessonCounts.set(lesson, 0);
      inTable = false; layout = null;
      continue;
    }
    if (!isTableRow(line)) { inTable = false; continue; }
    if (isSeparator(line)) continue;

    const cells = splitRow(line);
    if (isHeader(cells)) {
      layout = cells.length >= 4
        ? { ru: 0, sing: 1, fem: 2, plur: 3 }
        : { ru: 0, sing: 1, fem: null, plur: 2 };
      inTable = true;
      continue;
    }
    if (!inTable || lesson == null || !layout) continue;

    const ru = cell(cells[layout.ru]);
    const ar = cell(cells[layout.sing]);
    if (!ru || !ar) continue;

    const idx = lessonCounts.get(lesson) + 1;
    lessonCounts.set(lesson, idx);

    const card = {
      id: `b${bookId}-l${lesson}-${idx}`,
      book: bookId,
      lesson,
      ru,
      ar,
      arPlural: layout.plur != null ? cell(cells[layout.plur]) : null,
    };
    const fem = layout.fem != null ? cell(cells[layout.fem]) : null;
    if (fem) card.arFem = fem;
    cards.push(card);
  }

  const lessons = [...lessonCounts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([n, count]) => ({ n, count }));
  return { cards, lessons };
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const allCards = [];
  const books = [];

  for (const b of manifest.books) {
    const { cards, lessons } = parseBook(b.id, resolve(DICT_DIR, b.file));
    allCards.push(...cards);
    books.push({ id: b.id, title: b.title, titleAr: b.titleAr ?? null, totalCards: cards.length, lessons });
    console.log(`  книга ${b.id} «${b.title}»: ${cards.length} карточек, ${lessons.length} уроков`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    books,
    totalCards: allCards.length,
    cards: allCards,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");

  // проверка уникальности id
  const ids = new Set();
  const dup = allCards.filter((c) => (ids.has(c.id) ? true : (ids.add(c.id), false)));
  if (dup.length) throw new Error("Дубликаты id: " + dup.slice(0, 5).map((c) => c.id).join(", "));

  console.log(`✓ cards.json: ${allCards.length} карточек, ${books.length} книг(а), id уникальны`);
  console.log(`  → ${OUT}`);
}

main();
