/* =========================================================================
   progress.js — простой учёт баллов (без интервального повторения).
   Балл слова = значение последней оценки:
     Снова = 0 → слабых
     Хорошо = 1 → к повтору
     Легко = 2 → изучено
   ========================================================================= */
import { APP, saveApp } from "./storage.js";

/** Текущий балл слова или null, если ещё не изучалось. */
export function scoreOf(id) {
  const s = APP.cards[id];
  return s && typeof s.score === "number" ? s.score : null;
}

export function isSeen(id) { return scoreOf(id) != null; }
export function isLearned(id) { return scoreOf(id) === 2; } // изучено
export function isReview(id) { return scoreOf(id) === 1; }  // к повтору
export function isWeak(id) { return scoreOf(id) === 0; }    // слабых

/** Поставить оценку g ∈ {0,1,2} — записывает балл и сохраняет (+ помечает для синка). */
export function rate(id, g) {
  APP.cards[id] = { score: g };
  saveApp(id);
}
