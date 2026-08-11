import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * G4 (v0.7.x) — Proxy de dev para `/api` -> backend real (`:3011`).
 *
 * Deliberado: o backend não tem CORS configurado (auditoria de G4,
 * confirmado em código — só existe checagem de Origin/Referer para
 * CSRF, nunca headers Access-Control-Allow-*). Em vez de alterar o
 * backend (fora de escopo desta fatia — "não tocar backend sem PARAR
 * e justificar"), o proxy de dev torna as chamadas same-origin do
 * ponto de vista do browser: nenhuma alteração de CÓDIGO no backend é
 * necessária. Em produção, o frontend precisa ser servido da MESMA
 * origem do backend (ou atrás de um reverse proxy) — decisão
 * operacional futura, fora do escopo de G4, registrada como risco no
 * relatório desta entrega.
 *
 * **Nota importante, não escondida**: o proxy do Vite reescreve o
 * header `Host` enviado ao backend, mas o browser continua enviando
 * seu próprio header `Origin` real (ex.: `http://localhost:5173`) em
 * toda requisição — isso é controlado pelo browser, não pelo proxy.
 * `DELETE /api/v1/sessions/current` (logout) valida `Origin`/`Referer`
 * contra `ALLOWED_ORIGINS` (CSRF, `csrfGuard.ts`) — então, para o
 * logout funcionar em dev, a origem real do Vite dev server precisa
 * estar em `ALLOWED_ORIGINS` no `.env` do backend. Isso é configuração
 * de ambiente (variável de env), não alteração de código — documentado
 * no relatório desta entrega, não resolvido silenciosamente aqui
 * porque a porta de dev pode variar por ambiente.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3011",
        changeOrigin: false,
        secure: false
      }
    }
  }
});
