import { assertIsolatedIntegrationDatabase } from "./integration-database-guard.js";

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
  if (env["RUN_INTEGRATION_TESTS"]?.toLowerCase() !== "true") {
    return false;
  }

  // Ponto central de isolamento: TODA suíte de integração passa por
  // aqui antes de migration, fixture ou escrita, então é aqui que o
  // banco alvo é validado. Lança (não retorna `false`) de propósito —
  // "ninguém pediu integração" é motivo para PULAR; "pediram integração
  // apontando para um banco real" é motivo para FALHAR alto, antes da
  // primeira escrita.
  //
  // A verificação existe por um incidente concreto: seis Identities
  // sintéticas de suíte de integração ficaram no banco de DEV e passaram
  // a aparecer na tela administrativa como se fossem gente.
  assertIsolatedIntegrationDatabase(env);
  return true;
}
