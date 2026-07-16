/* =========================================================================
   data.js — загрузка словаря (cards.json) и построение индексов.
   Поддерживает несколько книг (томов). Структура cards.json:
     { books:[{id,title,titleAr,lessons:[{n,count}]}], cards:[{id,book,lesson,...}] }
   ========================================================================= */

export let CARDS = {};   // id -> карточка
export let BOOKS = [];   // [{id,title,titleAr,lessons:[{n,count,cards:[...]}],cards:[...]}]
export let ALL_IDS = [];

export async function loadCards() {
  // Таймаут: зависшая сеть в Telegram-вебвью не должна оставлять вечный пустой
  // экран — по истечении времени fetch прерывается и ошибка уходит в UI (main.js).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    res = await fetch(import.meta.env.BASE_URL + "cards.json", { signal: ctrl.signal });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "Словарь не загрузился: превышено время ожидания" : "Сеть недоступна: " + e.message);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error("cards.json не загружен: " + res.status);
  const data = await res.json();

  CARDS = {};
  for (const c of data.cards) CARDS[c.id] = c;

  BOOKS = data.books.map((b) => {
    const bookCards = data.cards.filter((c) => c.book === b.id);
    const byLesson = new Map();
    for (const c of bookCards) {
      if (!byLesson.has(c.lesson)) byLesson.set(c.lesson, []);
      byLesson.get(c.lesson).push(c);
    }
    return {
      id: b.id,
      title: b.title,
      titleAr: b.titleAr,
      cards: bookCards,
      lessons: b.lessons.map((l) => ({ n: l.n, count: l.count, cards: byLesson.get(l.n) || [] })),
    };
  });

  ALL_IDS = data.cards.map((c) => c.id);
  return data;
}

/**
 * HTML арабской стороны карточки с учётом настройки числа.
 * number: "sing" | "plur" | "both".
 */
export function arabicHTML(card, number) {
  const main = (s) => `<div class="word-ar">${s}</div>`;
  const sub = (tag, s) => `<div class="ar-sub"><span class="tag">${tag}</span>${s}</div>`;

  if (number === "plur") {
    if (card.arPlural) return main(card.arPlural);
    return main(card.ar) + `<div class="note">мн. числа нет</div>`;
  }
  if (number === "both") {
    let html = main(card.ar);
    if (card.arFem) html += sub("ж.р.", card.arFem);
    if (card.arPlural) html += sub("мн.ч.", card.arPlural);
    return html;
  }
  // "sing"
  let html = main(card.ar);
  if (card.arFem) html += sub("ж.р.", card.arFem);
  return html;
}
