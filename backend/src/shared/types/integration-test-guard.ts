/**
 * Guard usado por todo teste de integração (*.integration.test.ts) para
 * decidir se deve de fato executar contra um MariaDB real, ou pular.
 *
 * Uso típico dentro de um describe.skipIf / it.skipIf:
 *
 *   const shouldRun = shouldRunIntegrationTests();
 *   describe.skipIf(!shouldRun)("MariaDbIdentityRepository (integração)", () => { ... });
 *
 * `npm test` (suíte padrão) já exclui *.integration.test.ts inteiramente
 * via vitest.config.ts — este guard é uma segunda camada de proteção,
 * para o caso de alguém rodar vitest apontando diretamente para um
 * arquivo de integração sem passar pela config padrão.
 */
export function shouldRunIntegrationTests(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["RUN_INTEGRATION_TESTS"]?.toLowerCase() === "true";
}
