/* =========================================================================
   main.js — точка входа. Инициализирует Telegram, грузит данные и прогресс,
   рендерит главный экран.
   ========================================================================= */
import "./styles.css";
import { initTelegram } from "./telegram.js";
import { loadCards } from "./data.js";
import { loadApp, syncPull } from "./storage.js";
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

  // Синхронизация с сервером — в фоне, не блокирует показ UI (offline-first).
  // syncPull сам обновит экран через onSynced, когда придёт серверное состояние.
  syncPull();
}

boot();
