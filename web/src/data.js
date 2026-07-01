/* =========================================================================
   data.js — загрузка словаря (cards.json) и построение индексов.
   ========================================================================= */

export let CARDS = {};   // id -> {id, lesson, ru, ar, arPlural, arFem?}
export let LESSONS = []; // [{n, count, cards:[card,...]}]
export let ALL_IDS = [];

export async function loadCards() {
  const res = await fetch(import.meta.env.BASE_URL + "cards.json");
  if (!res.ok) throw new Error("cards.json не загружен: " + res.status);
  const data = await res.json();

  CARDS = {};
  const byLesson = new Map();
  for (const c of data.cards) {
    CARDS[c.id] = c;
    if (!byLesson.has(c.lesson)) byLesson.set(c.lesson, []);
    byLesson.get(c.lesson).push(c);
  }
  LESSONS = data.lessons.map((l) => ({
    n: l.n,
    count: l.count,
    cards: byLesson.get(l.n) || [],
  }));
  ALL_IDS = data.cards.map((c) => c.id);
  return data;
}

/**
 * HTML арабской стороны карточки с учётом настройки числа.
 * number: "sing" | "plur" | "both".
 * Возвращает разметку: основное слово крупно + доп. формы мельче.
 */
export function arabicHTML(card, number) {
  const main = (s) => `<div class="word-ar">${s}</div>`;
  const sub = (tag, s) => `<div class="ar-sub"><span class="tag">${tag}</span>${s}</div>`;

  if (number === "plur") {
    if (card.arPlural) return main(card.arPlural);
    // у слова нет множественного — показываем единственное с пометкой
    return main(card.ar) + `<div class="note">мн. числа нет</div>`;
  }

  if (number === "both") {
    let html = main(card.ar);
    if (card.arFem) html += sub("ж.р.", card.arFem);
    if (card.arPlural) html += sub("мн.ч.", card.arPlural);
    return html;
  }

  // "sing" (по умолчанию)
  let html = main(card.ar);
  if (card.arFem) html += sub("ж.р.", card.arFem);
  return html;
}
