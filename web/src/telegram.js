/* =========================================================================
   telegram.js — тонкая обёртка над Telegram.WebApp с фолбэком для браузера.
   В обычном браузере (разработка) все методы — безопасные заглушки.
   ========================================================================= */

const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : null;

export const isTelegram = !!tg && !!tg.initData;

/** Инициализация: раскрыть на весь экран, покрасить хром под палитру. */
export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor("#FAFAF9"); // перекрасим позже под тему
    if (tg.setBackgroundColor) tg.setBackgroundColor("#FAFAF9");
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); // чтобы свайп не закрывал апп во время листания
  } catch (e) {
    console.warn("[tg] init", e);
  }
}

/** Схема Telegram-клиента: "light" | "dark" (или null вне Telegram). */
export function tgColorScheme() {
  return tg?.colorScheme ?? null;
}

/** Перекрасить нативный хедер/фон под текущую тему приложения. */
export function tgApplyThemeColors(theme) {
  if (!tg) return;
  const bg = theme === "dark" ? "#12100E" : "#FAFAF9";
  try {
    tg.setHeaderColor?.(bg);
    tg.setBackgroundColor?.(bg);
  } catch {}
}

/** Данные для авторизации на бэкенде (подписанная строка). */
export function tgInitData() {
  return tg?.initData ?? "";
}

/** Пользователь Telegram (для приветствия/отладки). */
export function tgUser() {
  return tg?.initDataUnsafe?.user ?? null;
}

/* ---------- Haptics ---------- */
export const haptic = {
  impact(style = "light") {
    try { tg?.HapticFeedback?.impactOccurred(style); } catch {}
  },
  select() {
    try { tg?.HapticFeedback?.selectionChanged(); } catch {}
  },
  notify(type = "success") {
    try { tg?.HapticFeedback?.notificationOccurred(type); } catch {}
  },
};

/* ---------- BackButton ----------
   onBack вызывается при нажатии нативной кнопки «назад» Telegram. */
export const backButton = {
  show(onBack) {
    if (!tg?.BackButton) return;
    try {
      tg.BackButton.show();
      tg.BackButton.offClick?.(this._h);
      this._h = onBack;
      tg.BackButton.onClick(onBack);
    } catch {}
  },
  hide() {
    if (!tg?.BackButton) return;
    try {
      if (this._h) tg.BackButton.offClick?.(this._h);
      this._h = null;
      tg.BackButton.hide();
    } catch {}
  },
  _h: null,
};
