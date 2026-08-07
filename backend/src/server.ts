import type { Server } from "node:http";

import { createApp } from "./app/http/createApp.js";
import { loadEnv, type Env } from "./app/config/env.js";

/**
 * Módulo reutilizável/import-safe: nada neste arquivo abre uma porta ou
 * executa qualquer efeito colateral só por ser importado — inclusive
 * `startServer()` só faz algo quando explicitamente CHAMADA por quem
 * importa este módulo. O entrypoint real do processo é
 * `src/main.ts`, não este arquivo.
 *
 * Motivo desta separação: a estratégia anterior detectava "sou o
 * entrypoint executado diretamente?" comparando `process.argv[1]` com
 * `import.meta.url` dentro do próprio `server.ts`, e chamava
 * `startServer()` automaticamente nesse caso. Isso funciona com
 * `node dist/server.js`, mas não é confiável sob gerenciamento do PM2
 * (bug real observado em DEV: PM2 reportava o processo `online`, mas
 * `startServer()` nunca era chamada — nenhum socket aberto, `/health`
 * nunca respondia, sem erro nos logs). Separar "módulo" de "entrypoint"
 * elimina essa classe de bug por completo: não há mais nenhuma detecção
 * heurística de "sou o módulo principal?" para dar errado.
 */

/**
 * Cria (mas não instala) a lógica de encerramento gracioso: fecha o
 * servidor HTTP, esperando as conexões em curso terminarem (comportamento
 * padrão de `server.close`), sem forçar `process.exit` — quem decide
 * encerrar o processo é `registerGracefulShutdown`, não esta função. Isso
 * mantém a função testável isoladamente (sem matar o processo de teste).
 */
export function createShutdownHandler(server: Server): () => Promise<void> {
  let shuttingDown = false;
  return async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };
}

/**
 * Instala os handlers de SIGTERM/SIGINT para encerramento gracioso.
 *
 * `exit` é injetável (default: `process.exit`) especificamente para
 * permitir testar esta função sem encerrar o processo de teste — os
 * testes substituem `exit` por uma função fake e disparam o sinal via
 * `process.emit(...)`, verificando que `exit(0)`/`exit(1)` seria chamado.
 */
export function registerGracefulShutdown(
  server: Server,
  options: { signals?: readonly NodeJS.Signals[]; exit?: (code: number) => void } = {}
): void {
  const signals = options.signals ?? ["SIGTERM", "SIGINT"];
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const shutdown = createShutdownHandler(server);

  for (const signal of signals) {
    process.once(signal, () => {
      shutdown()
        .then(() => exit(0))
        .catch(() => exit(1));
    });
  }
}

/**
 * Ponto de entrada real do processo. Lê e valida env (`loadEnv` lança se
 * a configuração for inválida — falha rápido, antes de abrir qualquer
 * porta), cria a app e faz o bind explícito em HOST:PORT (default
 * 127.0.0.1:3011 — nunca 0.0.0.0 por omissão nesta fatia, sem Nginx na
 * frente).
 *
 * `env` é injetável (default: `loadEnv()`, que lê `process.env`) — só
 * para permitir testar `startServer()` de verdade (abrindo um servidor
 * HTTP real, não um mock) sem depender da porta fixa 3011 nem mutar
 * `process.env` global; passar `{ ...loadEnv(), PORT: 0 }` num teste faz
 * o SO escolher uma porta livre, exatamente como os demais testes HTTP
 * desta suíte já fazem via `app.listen(0)`.
 */
export function startServer(env: Env = loadEnv()): Server {
  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    // eslint-disable-next-line no-console -- único log de bootstrap, sem dado sensível.
    console.log(`pctec-ingressa backend ouvindo em ${env.HOST}:${env.PORT} (NODE_ENV=${env.NODE_ENV})`);
  });

  registerGracefulShutdown(server);
  return server;
}
