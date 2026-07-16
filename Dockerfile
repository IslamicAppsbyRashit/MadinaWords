# MadinaWords — единый образ: собирает фронтенд и запускает сервер, который его раздаёт.

# ---- 1) сборка фронтенда (web/dist + cards.json) ----
FROM node:22-alpine AS web
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY scripts ./scripts
COPY dictionary ./dictionary
COPY web ./web
RUN cd web && npm run build

# ---- 2) зависимости сервера (компиляция better-sqlite3) ----
FROM node:22-alpine AS server-deps
WORKDIR /app/server
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

# ---- 3) финальный образ ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S app && adduser -S app -u 1001

COPY --from=server-deps --chown=app:app /app/server/node_modules ./server/node_modules
COPY --chown=app:app server ./server
COPY --from=web --chown=app:app /app/web/dist ./web/dist

# База лежит на томе (см. DEPLOY.md) — иначе прогресс теряется при редеплое.
ENV DB_PATH=/data/madinawords.db
RUN mkdir -p /data && chown app:app /data
VOLUME /data

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server/src/index.js"]
