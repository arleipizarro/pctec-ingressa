import type { Server } from "node:http";
import { fileURLToPath } from "node:url";

import { createApp } from "./app/http/createApp.js";
import { loadEnv } from "./app/config/env.js";

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
 */
export function startServer(): Server {
  const env = loadEnv();
  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    // eslint-disable-next-line no-console -- único log de bootstrap, sem dado sensível.
    console.log(`pctec-ingressa backend ouvindo em ${env.HOST}:${env.PORT} (NODE_ENV=${env.NODE_ENV})`);
  });

  registerGracefulShutdown(server);
  return server;
}

// Só inicia de fato quando este arquivo é o entrypoint executado
// diretamente (`node dist/server.js`) — nunca como efeito colateral de
// importar o módulo (ex.: a partir de um teste, que importa `createApp`/
// `startServer` sem querer abrir uma porta de verdade).
const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  startServer();
}
