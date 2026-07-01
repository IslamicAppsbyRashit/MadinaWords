import { defineConfig } from "vite";

// Telegram Mini App раздаётся как статика. base:"./" — чтобы работало из любого
// подпути (Fastify отдаёт из /app, GitHub Pages из /repo и т.п.).
export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    host: true, // доступ с телефона по локальной сети для теста в Telegram
  },
  build: {
    outDir: "dist",
    target: "es2020",
    sourcemap: true,
  },
});
