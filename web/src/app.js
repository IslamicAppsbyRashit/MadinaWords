/* =========================================================================
   app.js — UI главного экрана, учебная сессия, модалки, настройки.
   Логика SRS-сессии портирована из example/medinah-flashcards.html.
   ========================================================================= */
import { APP, saveApp, resetProgress, onPersistError, onSyncError, onSynced, SETTINGS_MARK } from "./storage.js";
import { CARDS, BOOKS, ALL_IDS, arabicHTML } from "./data.js";
import { rate, scoreOf, isSeen, isLearned, isReview, isWeak } from "./progress.js";
import { haptic, backButton, tgApplyThemeColors, tgColorScheme } from "./telegram.js";

const $ = (id) => document.getElementById(id);
const shuffle = (a) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ---------- STATS / HOME ---------- */
const learnedCount = () => ALL_IDS.filter(isLearned).length; // 2 балла
const reviewCount = () => ALL_IDS.filter(isReview).length;   // 1 балл
const weakCount = () => ALL_IDS.filter(isWeak).length;       // 0 баллов
// «На повторение» собирает всё, что уже трогали, но ещё не выучили (0 или 1 балл)
const toReviewIds = () => ALL_IDS.filter((id) => isSeen(id) && !isLearned(id));

function renderHome() {
  $("stTotal").textContent = ALL_IDS.length;
  $("stSeen").textContent = learnedCount();
  $("stDue").textContent = reviewCount();
  $("stWeak").textContent = weakCount();

  const rv = toReviewIds().length;
  $("reviewBadge").textContent = rv;
  $("reviewSub").textContent = rv ? "Слова, которые нужно повторить" : "Всё повторено — отлично";
  $("reviewBtn").disabled = rv === 0;

  // подзаголовок бренда: один том → его название, несколько → «Мединский курс»
  $("brandEyebrow").textContent = BOOKS.length > 1 ? "Мединский курс" : (BOOKS[0]?.title || "Мединский курс");

  renderBooks();
}

const multiBook = () => BOOKS.length > 1;

/** Метка урока для сессии (с названием книги, если книг несколько). */
function lessonLabel(book, L) {
  return multiBook() ? `${book.title} · Урок ${L.n}` : "Урок " + L.n;
}

function renderBooks() {
  const container = $("booksContainer");
  container.innerHTML = "";
  BOOKS.forEach((book, bi) => {
    const head = document.createElement("div");
    head.className = "section-head";
    const title = multiBook() ? book.title : "Уроки";
    const right = bi === 0
      ? `<span class="hint">Нажми, чтобы учить</span>`
      : multiBook() && book.titleAr ? `<span class="hint ar">${book.titleAr}</span>` : "";
    head.innerHTML = `<h2>${title}</h2>${right}`;
    container.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "lessons";
    for (const L of book.lessons) grid.appendChild(makeLessonCard(book, L));
    container.appendChild(grid);
  });
}

function makeLessonCard(book, L) {
  const ids = L.cards.map((c) => c.id);
  const learned = ids.filter(isLearned).length;
  const attention = ids.filter((id) => isSeen(id) && !isLearned(id)).length; // 0 или 1 балл
  const newC = ids.filter((id) => !isSeen(id)).length;
  const pct = Math.round((learned / ids.length) * 100);
  const line2 = newC ? `${newC} новых` : attention ? `${attention} на повтор` : "пройден";

  // Контейнер + две отдельные кнопки: основная (учить) и «список».
  // Так нет вложенных интерактивных элементов и обе доступны с клавиатуры.
  const el = document.createElement("div");
  el.className = "lesson";
  el.innerHTML = `
    <button class="lesson-study" aria-label="Учить: ${lessonLabel(book, L)}, ${L.count} слов, изучено ${learned}">
      ${attention ? `<span class="due-dot" aria-hidden="true"><i></i>${attention}</span>` : ``}
      <div class="num">Урок ${L.n}</div>
      <div class="ttl">${L.count} слов</div>
      <div class="ring-row">
        <div class="ring" style="--p:${pct}" aria-hidden="true"><b>${pct}%</b></div>
        <div class="meta"><span class="seen">${learned}/${L.count}</span> изучено<br>${line2}</div>
      </div>
    </button>
    <button class="list-btn" aria-label="Список слов урока ${L.n}">список</button>`;
  el.querySelector(".lesson-study").addEventListener("click", () =>
    startSession(buildLessonQueue(L), lessonLabel(book, L))
  );
  el.querySelector(".list-btn").addEventListener("click", () => openList(book, L));
  return el;
}

function buildLessonQueue(L) {
  const ids = L.cards.map((c) => c.id);
  let q = ids.filter((id) => !isLearned(id)); // всё, что ещё не выучено (новые + 0/1 балл)
  if (q.length === 0) q = ids.slice(); // всё выучено → повторяем весь урок
  return shuffle(q);
}

/* ---------- STUDY SESSION ---------- */
let SESSION = null;
let focusReturn = null; // куда вернуть фокус после закрытия оверлея/модалки

function startSession(queue, label) {
  if (!queue.length) return;
  focusReturn = document.activeElement;
  SESSION = {
    queue, idx: 0, label, total: queue.length, done: 0, flipped: false,
    recap: { nw: 0, rev: 0, again: 0 },
  };
  $("studyLabel").textContent = label;
  $("doneScreen").classList.add("hidden");
  $("studyMain").classList.remove("hidden");
  const study = $("study");
  study.classList.add("show");
  study.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  backButton.show(closeStudy);
  showCard();
  $("revealBtn").focus(); // фокус в оверлей — сразу можно действовать с клавиатуры
}

const curId = () => SESSION.queue[SESSION.idx];

function frontIsArabic() {
  const d = APP.settings.dir;
  if (d === "ar") return true;
  if (d === "ru") return false;
  return SESSION.idx % 2 === 0; // mix
}

function showCard() {
  SESSION.flipped = false;
  const fc = $("flashcard");
  fc.classList.add("no-anim");
  fc.classList.remove("flipped");
  void fc.offsetWidth; // reflow — мгновенно вернуть на лицо
  const c = CARDS[curId()];
  const num = APP.settings.number;
  const front = $("frontContent");
  const back = $("backContent");

  if (frontIsArabic()) {
    $("frontKicker").textContent = "Арабский";
    $("backKicker").textContent = "Перевод";
    front.innerHTML = arabicHTML(c, num);
    back.innerHTML = `<div class="word-ru">${c.ru}</div>`;
  } else {
    $("frontKicker").textContent = "Перевод";
    $("backKicker").textContent = "Арабский";
    front.innerHTML = `<div class="word-ru-front">${c.ru}</div>`;
    back.innerHTML = arabicHTML(c, num) + `<div class="note">${c.ru}</div>`;
  }

  $("revealBtn").classList.remove("hidden");
  $("rateRow").classList.add("hidden");
  $("studyCount").textContent = SESSION.done + "/" + SESSION.total;
  $("progFill").style.width = (SESSION.done / SESSION.total) * 100 + "%";

  requestAnimationFrame(() => fc.classList.remove("no-anim"));
}

function flip() {
  if (SESSION.flipped) return;
  SESSION.flipped = true;
  haptic.impact("light");
  $("flashcard").classList.add("flipped");
  $("revealBtn").classList.add("hidden");
  $("rateRow").classList.remove("hidden");
}

function answer(g) {
  if (!SESSION.flipped) return;
  haptic.select();
  const id = curId();
  const wasNew = !isSeen(id);
  rate(id, g);
  if (g === 0) SESSION.recap.again++;
  else if (wasNew) SESSION.recap.nw++;
  else SESSION.recap.rev++;

  if (g === 0) {
    // «Снова» — вернуть карточку чуть позже в этой же сессии
    SESSION.queue.splice(SESSION.idx, 1);
    const insertAt = Math.min(SESSION.queue.length, SESSION.idx + 4);
    SESSION.queue.splice(insertAt, 0, id);
    SESSION.total = SESSION.done + SESSION.queue.length - SESSION.idx;
    showCard();
  } else {
    SESSION.done++;
    SESSION.idx++;
    if (SESSION.idx >= SESSION.queue.length) finishSession();
    else showCard();
  }
}

function finishSession() {
  haptic.notify("success");
  $("studyMain").classList.add("hidden");
  $("progFill").style.width = "100%";
  $("studyCount").textContent = SESSION.done + "/" + SESSION.done;
  $("doneScreen").classList.remove("hidden");
  $("recapNew").textContent = SESSION.recap.nw;
  $("recapRev").textContent = SESSION.recap.rev;
  $("recapAgain").textContent = SESSION.recap.again;
  const rv = toReviewIds().length;
  $("doneMsg").textContent = rv ? "Осталось повторить: " + rv : "Все слова выучены, ма ша Аллах.";
  $("doneMore").style.display = rv ? "block" : "none";
  saveApp();
}

function closeStudy() {
  const study = $("study");
  study.classList.remove("show");
  study.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  SESSION = null;
  backButton.hide();
  renderHome();
  focusReturn?.focus?.();
}

/* ---------- WORD LIST ---------- */
let listCtx = null; // {book, L}

function strengthBadge(id) {
  const s = scoreOf(id);
  if (s === null) return `<span class="wl-badge"><i></i>новое</span>`;
  if (s === 0) return `<span class="wl-badge s1"><i></i>слабое</span>`;
  if (s === 1) return `<span class="wl-badge s2"><i></i>к повтору</span>`;
  return `<span class="wl-badge s4"><i></i>изучено</span>`;
}

function openList(book, L) {
  listCtx = { book, L };
  $("listTitle").textContent = lessonLabel(book, L) + " · " + L.count + " слов";
  const body = $("listBody");
  body.innerHTML = "";
  for (const c of L.cards) {
    const plural = c.arPlural ? `<small>мн.ч. ${c.arPlural}</small>` : "";
    const row = document.createElement("div");
    row.className = "wl-item";
    row.innerHTML = `<div class="wl-ar">${c.ar}</div><div class="wl-ru">${c.ru}${plural}</div>${strengthBadge(c.id)}`;
    body.appendChild(row);
  }
  openModal("listModal");
}

/* ---------- MODALS / SETTINGS ---------- */
function openModal(id) {
  focusReturn = document.activeElement;
  $(id).classList.add("show");
  document.body.style.overflow = "hidden";
  backButton.show(() => closeModal(id));
  // фокус на первую кнопку внутри модалки
  $(id).querySelector(".modal button")?.focus?.();
}
function closeModal(id) {
  $(id).classList.remove("show");
  const studyOpen = $("study").classList.contains("show");
  if (!studyOpen) { document.body.style.overflow = ""; backButton.hide(); }
  else backButton.show(closeStudy);
  focusReturn?.focus?.();
}

export function applyTheme() {
  document.body.classList.toggle("theme-dark", APP.settings.theme === "dark");
  tgApplyThemeColors(APP.settings.theme);
}
function syncSettingsUI() {
  const set = (sel, key) =>
    document.querySelectorAll(sel).forEach((b) => {
      const on = b.dataset[key] === APP.settings[key === "num" ? "number" : key === "dir" ? "dir" : "theme"];
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  set("#dirSeg button", "dir");
  set("#numSeg button", "num");
  set("#themeSeg button", "theme");
}

/** Показать пользователю, что прогресс не сохраняется (ошибка/повреждение хранилища). */
function showPersistBanner(state) {
  if ($("persistBanner")) return;
  const el = document.createElement("div");
  el.id = "persistBanner";
  el.className = "persist-banner";
  el.setAttribute("role", "alert");
  el.textContent = state.loadWasCorrupt
    ? "Не удалось прочитать сохранённый прогресс — он не будет перезаписан. Сбросить можно в настройках."
    : "Прогресс не сохраняется: хранилище недоступно. Изменения пропадут после закрытия приложения.";
  document.body.appendChild(el);
}

/** Баннер о проблеме синхронизации с сервером (прогресс при этом сохраняется локально). */
function showSyncBanner(kind) {
  const existing = $("syncBanner");
  if (!kind) { existing?.remove(); return; }
  if (existing) return;
  const el = document.createElement("div");
  el.id = "syncBanner";
  el.className = "persist-banner sync";
  el.setAttribute("role", "alert");
  el.textContent = kind === "auth"
    ? "Облачная синхронизация недоступна — переоткройте приложение. Прогресс сохраняется локально."
    : "Часть данных не удалось синхронизировать с сервером.";
  document.body.appendChild(el);
}

/* ---------- WIRE UP ---------- */
export function wireUp() {
  onPersistError(showPersistBanner);
  onSyncError(showSyncBanner);
  // после прихода серверного состояния — обновить тему и главный экран
  onSynced(() => { applyTheme(); renderHome(); });

  $("reviewBtn").addEventListener("click", () => {
    const rv = shuffle(toReviewIds());
    if (rv.length) startSession(rv, "Повторение");
  });
  $("studyClose").addEventListener("click", closeStudy);
  $("flashcard").addEventListener("click", flip);
  $("revealBtn").addEventListener("click", flip);
  document.querySelectorAll(".rate").forEach((b) => b.addEventListener("click", () => answer(parseInt(b.dataset.g))));
  $("doneHome").addEventListener("click", closeStudy);
  $("doneMore").addEventListener("click", () => {
    const rv = shuffle(toReviewIds());
    if (rv.length) startSession(rv, "Повторение");
    else closeStudy();
  });

  $("openSettings").addEventListener("click", () => { syncSettingsUI(); openModal("settingsModal"); });
  document.querySelectorAll("[data-close]").forEach((x) =>
    x.addEventListener("click", (e) => closeModal(e.target.closest(".modal-bg").id))
  );
  document.querySelectorAll(".modal-bg").forEach((bg) =>
    bg.addEventListener("click", (e) => { if (e.target === bg) closeModal(bg.id); })
  );

  $("dirSeg").addEventListener("click", (e) => {
    if (e.target.dataset.dir) { APP.settings.dir = e.target.dataset.dir; saveApp(SETTINGS_MARK); syncSettingsUI(); }
  });
  $("numSeg").addEventListener("click", (e) => {
    if (e.target.dataset.num) { APP.settings.number = e.target.dataset.num; saveApp(SETTINGS_MARK); syncSettingsUI(); }
  });
  $("themeSeg").addEventListener("click", (e) => {
    if (e.target.dataset.theme) { APP.settings.theme = e.target.dataset.theme; APP.settings._themeTouched = true; saveApp(SETTINGS_MARK); applyTheme(); syncSettingsUI(); }
  });
  $("resetBtn").addEventListener("click", () => {
    if (confirm("Сбросить весь прогресс повторений? Это нельзя отменить.")) {
      resetProgress();
      closeModal("settingsModal");
      renderHome();
    }
  });
  $("listStudy").addEventListener("click", () => {
    if (!listCtx) return;
    closeModal("listModal");
    startSession(buildLessonQueue(listCtx.L), lessonLabel(listCtx.book, listCtx.L));
  });

  // Escape закрывает открытую модалку
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const openM = document.querySelector(".modal-bg.show");
    if (openM) { e.preventDefault(); closeModal(openM.id); }
  });

  // клавиатура (десктопный Telegram / браузер)
  document.addEventListener("keydown", (e) => {
    if (!$("study").classList.contains("show")) return;
    if (!$("doneScreen").classList.contains("hidden")) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (SESSION && !SESSION.flipped) flip(); }
    else if (SESSION && SESSION.flipped && ["1", "2", "3"].includes(e.key)) answer(parseInt(e.key) - 1);
    else if (e.key === "Escape") closeStudy();
  });
}

export { renderHome };

/** Если пользователь не выбирал тему вручную — подстроиться под Telegram. */
export function applyInitialTheme() {
  const scheme = tgColorScheme();
  if (scheme && !APP.settings._themeTouched) APP.settings.theme = scheme;
  applyTheme();
}
