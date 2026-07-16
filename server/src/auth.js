/* =========================================================================
   auth.js — проверка подлинности Telegram initData.
   Алгоритм из документации Telegram Mini Apps:
     secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
     hash       = HMAC_SHA256(key=secret_key,  msg=data_check_string)
   data_check_string — все поля (кроме hash), отсортированные по ключу,
   в формате "key=value", соединённые "\n".
   ========================================================================= */
import crypto from "node:crypto";

/**
 * Проверяет подпись initData. Возвращает объект пользователя Telegram
 * при успехе или null при неверной подписи / просроченных данных.
 * @param {string} initData  сырая строка Telegram.WebApp.initData
 * @param {string} botToken  токен бота
 * @param {number} maxAgeSec 0 — не проверять возраст; иначе максимум секунд
 */
export function validateInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || typeof initData !== "string") return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // data_check_string: сортируем по ключу, значения — как есть (уже раскодированы)
  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calcHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // сравнение постоянного времени
  const a = Buffer.from(calcHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // защита от replay: initData не должна быть слишком старой
  if (maxAgeSec > 0) {
    const authDate = Number(params.get("auth_date"));
    if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  }

  const userRaw = params.get("user");
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw);
    if (!user || typeof user.id !== "number") return null;
    return user;
  } catch {
    return null;
  }
}

/** Достаёт сырую initData из запроса: "Authorization: tma <initData>" или заголовок X-Telegram-Init-Data. */
export function extractInitData(req) {
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("tma ")) return auth.slice(4);
  const h = req.headers["x-telegram-init-data"];
  if (typeof h === "string" && h) return h;
  return null;
}
