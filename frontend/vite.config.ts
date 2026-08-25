import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * O dev server encaminha `/api` para o backend local em vez de o
 * frontend falar com outra origem: assim o cookie de sessão
 * (HttpOnly, SameSite) vale em desenvolvimento exatamente como valerá
 * em produção atrás do Nginx — sem CORS especial e sem token em
 * storage do browser.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3011", changeOrigin: false }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"]
  }
});
