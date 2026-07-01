/* =========================================================================
   main.js — точка входа. Инициализирует Telegram, грузит данные и прогресс,
   рендерит главный экран.
   ========================================================================= */
import "./styles.css";
import { initTelegram } from "./telegram.js";
import { loadCards } from "./data.js";
import { loadApp } from "./storage.js";
import { wireUp, renderHome, applyInitialTheme } from "./app.js";

async function boot() {
  initTelegram();
  try {
    await Promise.all([loadCards(), loadApp()]);
  } catch (e) {
    console.error("Ошибка загрузки:", e);
    document.body.innerHTML =
      `<div style="padding:40px;text-align:center;font-family:sans-serif">
         Не удалось загрузить словарь.<br><small>${e.message}</small>
       </div>`;
    return;
  }
  applyInitialTheme();
  wireUp();
  renderHome();
}

boot();
