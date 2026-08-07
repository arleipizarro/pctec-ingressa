import { startServer } from "./server.js";

/**
 * Entrypoint executável mínimo — é ISTO que o PM2 (`ecosystem.config.cjs`)
 * e `npm start` executam (`node dist/main.js`), nunca `dist/server.js`
 * diretamente.
 *
 * Responsabilidade única: chamar `startServer()` e tratar uma falha
 * fatal de bootstrap (ex.: `loadEnv()` lançando por configuração
 * inválida, ou a porta já estar em uso) de forma sanitizada — nunca
 * imprime detalhes que possam conter dado sensível, sempre define
 * `process.exitCode` diferente de zero para que o PM2 (ou qualquer
 * supervisor de processo) veja a falha corretamente e possa reiniciar
 * conforme sua própria política, em vez de um processo "zumbi" que saiu
 * silenciosamente com código 0.
 *
 * Deliberadamente SEM nenhuma detecção de "sou o módulo principal?" —
 * este arquivo só existe para ser executado diretamente; toda a lógica
 * reutilizável/testável fica em `server.ts`, que nunca inicia nada
 * sozinho ao ser importado.
 */
try {
  startServer();
} catch (error) {
  // eslint-disable-next-line no-console -- falha fatal de bootstrap; nunca imprime a causa original por completo (pode conter dado sensível de configuração).
  console.error("Falha fatal ao iniciar o servidor. Veja a configuração (HOST/PORT/NODE_ENV) e tente novamente.");
  if (error instanceof Error) {
    // eslint-disable-next-line no-console -- só o nome/mensagem da classe de erro, nunca stack completo ou payload de configuração.
    console.error(`Causa: ${error.name}: ${error.message}`);
  }
  process.exitCode = 1;
}
