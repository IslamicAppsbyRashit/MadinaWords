# MadinaWords — фронтенд

Telegram Mini App для изучения слов мединского курса (флеш-карточки + интервальное повторение). Стиль **Stone & Gold** (см. `../design-system/madinawords/MASTER.md`).

## Стек
- Vite + vanilla JS (ES-модули), без фреймворка — лёгкий бандл для Mini App.
- Шрифты: Noto Naskh Arabic (арабский) + Raleway (UI).
- Telegram WebApp SDK (с фолбэком для обычного браузера при разработке).

## Команды
```bash
npm install
npm run dev       # сначала собирает cards.json из словаря, потом vite dev
npm run build     # cards.json + прод-сборка в dist/
npm run preview   # предпросмотр собранного
```
`predev`/`prebuild` автоматически запускают `../scripts/build-dict.mjs`, который
парсит `../dictionary/slovar_medinа_tom1.md` в `public/cards.json`.

## Структура
```
web/
├─ index.html          разметка экранов (home / study / модалки)
├─ public/cards.json   словарь (генерируется, в git не коммитим)
└─ src/
   ├─ main.js          точка входа (init → загрузка → рендер)
   ├─ data.js          загрузка cards.json + формы числа (ед/мн/оба)
   ├─ progress.js      учёт баллов: Снова=0, Хорошо=1, Легко=2
   ├─ storage.js       localStorage (+ хук синка с бэкендом — Этап 4)
   ├─ telegram.js      обёртка Telegram SDK (тема, haptics, BackButton)
   ├─ app.js           UI: главный экран, сессия, модалки, настройки
   └─ styles.css       дизайн-система Stone & Gold
```

## Настройки (в приложении)
- **Направление карточек**: Араб→Рус / Рус→Араб / вперемешку.
- **Число слова**: ед. / мн. / оба (использует все формы из словаря).
- **Тема**: светлая / тёмная (по умолчанию подстраивается под Telegram).

## Дальше (не в этом этапе)
- Этап 3: бэкенд на Fastify + SQLite (валидация Telegram `initData`).
- Этап 4: синхронизация прогресса — заглушки `syncPull/syncPush` в `storage.js`.
