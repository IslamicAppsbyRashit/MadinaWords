# Деплой MadinaWords

Единый образ: сервер (Fastify) раздаёт собранный фронтенд и API синхронизации.
Telegram Mini App **требует HTTPS** — хостинг должен давать TLS (у Render/Railway/Fly он есть из коробки).

## Переменные окружения

| Переменная | Обязательна | Назначение |
|---|---|---|
| `BOT_TOKEN` | да | Токен бота из @BotFather. **Секрет** — задавать через секреты хостинга, не в образ. |
| `PORT` | нет (3000) | Порт HTTP. |
| `HOST` | нет (0.0.0.0) | Интерфейс прослушивания. |
| `INITDATA_MAX_AGE` | нет (86400) | Максимальный возраст Telegram initData в секундах (защита от replay). |
| `DB_PATH` | нет | Путь к файлу SQLite. В Docker по умолчанию `/data/madinawords.db`. |

## ⚠️ Персистентность базы (критично)

Прогресс лежит в SQLite-файле. На эфемерной ФС (типичный free-tier) он **стирается при каждом редеплое**.
Обязательно: примонтировать постоянный том к каталогу с `DB_PATH` (в образе — `/data`), либо позже мигрировать на управляемый Postgres.

- **Render:** добавить Persistent Disk, смонтировать в `/data`.
- **Railway:** добавить Volume на `/data`.
- **Fly.io:** `fly volumes create data`, смонтировать в `/data`.

## Docker

```bash
# сборка
docker build -t madinawords .

# запуск (том для БД + секрет-токен)
docker run -d --name madinawords \
  -p 3000:3000 \
  -e BOT_TOKEN=xxx:yyy \
  -v madinawords_data:/data \
  madinawords
```

Health-check: `GET /api/health` → `{ ok: true }` (уже в HEALTHCHECK образа).

## Деплой на Fly.io (пошагово, бесплатно)

Fly собирает Docker-образ у себя — локальный Docker не нужен. Конфиг уже готов: `fly.toml`.

```bash
# 1. Установить flyctl (macOS)
brew install flyctl        # или:  curl -L https://fly.io/install.sh | sh

# 2. Регистрация/вход (в кабинете привязать карту — в рамках бесплатного лимита списаний нет)
fly auth signup            # или уже есть аккаунт:  fly auth login

# 3. Из корня проекта — создать приложение (пока без деплоя)
cd "путь/к/MadinaWords"
fly launch --no-deploy
#   • «copy existing fly.toml configuration?» → Yes
#   • имя приложения → уникальное, напр. madinawords-rashit
#   • регион → fra (Франкфурт) или waw (Варшава)
#   • Postgres/Redis/прочее → No

# 4. Постоянный том для SQLite (регион = тот же, что выбрал в шаге 3!)
fly volumes create data --size 1 --region fra

# 5. Токен бота как секрет (значение — из server/.env)
fly secrets set BOT_TOKEN=<токен_из_server/.env>

# 6. Деплой
fly deploy

# 7. Проверка
fly open                                   # откроет https://<app>.fly.dev
#   и здоровье:  https://<app>.fly.dev/api/health  →  {"ok":true}
```

Обновление после изменений: `fly deploy` заново.
Логи: `fly logs`. Статус: `fly status`. Поднять память при OOM: `fly scale memory 512`.

## Подключение к боту

1. Собрать/задеплоить, получить публичный HTTPS-URL.
2. В @BotFather: `/mybots` → бот → **Bot Settings → Menu Button / Web App** → указать URL.
3. Открыть бота в Telegram, нажать кнопку меню — откроется Mini App.

## Production-чеклист (из deployment-patterns, под этот проект)

**Приложение**
- [x] Нет секретов в коде/образе (`BOT_TOKEN` — через env, `.env` в `.gitignore` и `.dockerignore`)
- [x] Health-эндпоинт возвращает статус (`/api/health`)
- [x] Структурное логирование (Fastify+Pino, JSON)
- [x] Корректное завершение по SIGTERM/SIGINT (закрытие HTTP и БД)
- [x] Ошибки записи прогресса не проглатываются (баннер пользователю + лог)

**Инфраструктура**
- [x] Образ на пиннутых версиях (`node:22-alpine`), multi-stage, non-root пользователь
- [x] Переменные окружения валидируются на старте (fail-fast, если нет `BOT_TOKEN`)
- [ ] **Постоянный том для SQLite** (см. выше) — настроить на хостинге
- [x] TLS — обеспечивается хостингом (обязателен для Telegram)

**Безопасность**
- [x] Авторизация по подписи Telegram initData (HMAC, timing-safe, проверка возраста)
- [x] CORS: `origin: true` — безопасно, т.к. авторизация не по кукам, а по подписанной initData. При желании сузить до своего домена.
- [ ] Rate limiting на публичные эндпоинты — добавить `@fastify/rate-limit` перед публичным запуском
- [ ] Скан зависимостей на CVE (`npm audit`) в CI

**Операции**
- [ ] Мониторинг аптайма на `/api/health`
- [ ] План отката (передеплой предыдущего образа/коммита)
