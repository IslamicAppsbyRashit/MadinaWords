#!/usr/bin/env node
/**
 * build-dict.mjs — превращает словарь мединского курса (.md) в cards.json.
 *
 * Формат словаря: несколько таблиц на урок. Поддерживаются два вида шапки:
 *   3 колонки: | Перевод | Единственное число            | Множественное число |
 *   4 колонки: | Перевод | Ед. число (м.р.) | Ед. число (ж.р.) | Множественное число |
 *
 * Особенности, которые учитываем:
 *   - Урок 11 отсутствует — нумерация уроков не сплошная.
 *   - Пустое множественное число обозначено «—» → arPlural = null.
 *   - Множественное может содержать варианты «سُرُرٌ / أَسِرَّةٌ» — сохраняем строкой.
 *   - Стабильные id: L{урок}-{порядковый номер внутри урока}. При дополнении
 *     словаря старые id не должны меняться → прогресс SRS не сбивается.
 *
 * Запуск:  node scripts/build-dict.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "dictionary/slovar_medinа_tom1.md");
const OUT = resolve(ROOT, "web/public/cards.json");

const EMPTY = new Set(["—", "-", "–", "", "—/—"]);

/** Нормализация ячейки: обрезаем пробелы; «—» → null. */
function cell(raw) {
  const v = (raw ?? "").trim();
  return EMPTY.has(v) ? null : v;
}

/** Разбор строки таблицы `| a | b | c |` → ["a","b","c"] (без крайних пустых). */
function splitRow(line) {
  const parts = line.split("|");
  // строки вида "| a | b |" дают ["", " a ", " b ", ""] — отбрасываем края
  if (parts.length && parts[0].trim() === "") parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
  return parts.map((p) => p.trim());
}

const isSeparator = (line) => /^\|?\s*:?-{2,}/.test(line.trim());
const isTableRow = (line) => line.trim().startsWith("|");
const isHeader = (cells) => cells[0] && /перевод/i.test(cells[0]);

function main() {
  const md = readFileSync(SRC, "utf8");
  const lines = md.split(/\r?\n/);

  const cards = [];
  const lessonCounts = new Map(); // n -> count
  let lesson = null;
  let layout = null; // {ru, sing, fem, plur} индексы колонок
  let inTable = false;

  for (const line of lines) {
    const lessonMatch = line.match(/^##\s*Урок\s+(\d+)/i);
    if (lessonMatch) {
      lesson = Number(lessonMatch[1]);
      if (!lessonCounts.has(lesson)) lessonCounts.set(lesson, 0);
      inTable = false;
      layout = null;
      continue;
    }

    if (!isTableRow(line)) {
      inTable = false; // пустая строка / текст / блок-цитата завершает таблицу
      continue;
    }
    if (isSeparator(line)) continue; // строка `|---|---|`

    const cells = splitRow(line);

    if (isHeader(cells)) {
      // определяем раскладку колонок по количеству ячеек
      if (cells.length >= 4) {
        layout = { ru: 0, sing: 1, fem: 2, plur: 3 }; // м.р. / ж.р. / мн.ч.
      } else {
        layout = { ru: 0, sing: 1, fem: null, plur: 2 };
      }
      inTable = true;
      continue;
    }

    if (!inTable || lesson == null || !layout) continue;

    const ru = cell(cells[layout.ru]);
    const ar = cell(cells[layout.sing]);
    if (!ru || !ar) continue; // без перевода или арабского слова карточку не делаем

    const idx = lessonCounts.get(lesson) + 1;
    lessonCounts.set(lesson, idx);

    const card = {
      id: `L${lesson}-${idx}`,
      lesson,
      ru,
      ar,
      arPlural: layout.plur != null ? cell(cells[layout.plur]) : null,
    };
    const fem = layout.fem != null ? cell(cells[layout.fem]) : null;
    if (fem) card.arFem = fem; // добавляем только когда есть (цвета, урок 22)

    cards.push(card);
  }

  const lessons = [...lessonCounts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([n, count]) => ({ n, count }));

  const out = {
    generatedAt: new Date().toISOString(),
    source: "slovar_medinа_tom1.md",
    volume: 1,
    totalCards: cards.length,
    lessons,
    cards,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(`✓ cards.json: ${cards.length} карточек, ${lessons.length} уроков`);
  console.log(`  уроки: ${lessons.map((l) => `${l.n}(${l.count})`).join(", ")}`);
  const withFem = cards.filter((c) => c.arFem).length;
  const withPlural = cards.filter((c) => c.arPlural).length;
  console.log(`  с мн.числом: ${withPlural} · с формой ж.р.: ${withFem}`);
  console.log(`  → ${OUT}`);
}

main();
