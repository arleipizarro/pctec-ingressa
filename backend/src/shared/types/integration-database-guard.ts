/**
 * Guarda de isolamento das suítes de integração.
 *
 * Chamada ANTES de qualquer migration, fixture ou escrita. Existe por um
 * incidente real: seis Identities sintéticas de suíte de integração
 * ficaram no banco de DEV e passaram a aparecer na tela administrativa
 * como se fossem gente. O erro não foi de quem escreveu o teste — foi de
 * o teste poder, silenciosamente, apontar para DEV quando a variável
 * estava ausente e o default entrava no lugar.
 *
 * Três exigências, sem escape:
 *
 * 1. `RUN_INTEGRATION_TESTS=true` — o consentimento explícito de rodar
 *    contra banco real;
 * 2. `DB_NAME` presente — nunca um default, porque default é exatamente
 *    como se acerta o banco errado;
 * 3. `DB_NAME` termina em `_test`.
 *
 * **Não existe flag de override.** Um `--force` aqui seria usado no dia
 * de pressa, que é o dia em que o erro custa mais caro. Para rodar
 * contra outro banco, o nome dele precisa terminar em `_test`.
 */
export class IntegrationDatabaseGuardError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "IntegrationDatabaseGuardError";
  }
}

/** Nomes que nunca podem receber escrita de teste, digam o que disserem. */
const BANCOS_PROIBIDOS: readonly string[] = ["pctec_ingressa_dev", "pctec_ingressa", "pctec_helpdesk"];

const SUFIXO_OBRIGATORIO = "_test";

export interface IntegrationDatabaseTarget {
  readonly database: string;
}

/**
 * Valida o alvo e devolve o nome do banco. Lança
 * `IntegrationDatabaseGuardError` com mensagem acionável — e nunca com
 * usuário, senha ou host, que não ajudam a corrigir e só espalham dado
 * sensível por log de CI.
 */
export function assertIsolatedIntegrationDatabase(
  env: NodeJS.ProcessEnv = process.env
): IntegrationDatabaseTarget {
  if (env["RUN_INTEGRATION_TESTS"]?.toLowerCase() !== "true") {
    throw new IntegrationDatabaseGuardError(
      "RUN_INTEGRATION_TESTS=true é obrigatório para suíte de integração — sem ele, nenhuma escrita acontece."
    );
  }

  const database = (env["DB_NAME"] ?? "").trim();
  if (database.length === 0) {
    throw new IntegrationDatabaseGuardError(
      "DB_NAME ausente. A suíte de integração NUNCA assume um banco por default: informe explicitamente um banco terminado em `_test`."
    );
  }

  if (BANCOS_PROIBIDOS.includes(database)) {
    throw new IntegrationDatabaseGuardError(
      `DB_NAME=${database} é um banco de uso real e nunca recebe escrita de teste. Use um banco terminado em \`_test\`.`
    );
  }

  if (!database.endsWith(SUFIXO_OBRIGATORIO)) {
    throw new IntegrationDatabaseGuardError(
      `DB_NAME=${database} não termina em \`${SUFIXO_OBRIGATORIO}\`. A suíte de integração só escreve em banco de teste.`
    );
  }

  return { database };
}

/**
 * `true` quando a suíte pode rodar. Usado em `describe.skipIf(...)` para
 * PULAR sem falhar quando ninguém pediu integração — diferente de
 * apontar para o banco errado, que precisa FALHAR alto.
 */
export function integrationSuiteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["RUN_INTEGRATION_TESTS"]?.toLowerCase() === "true";
}

/**
 * Prefixo único por execução: fixtures de duas rodadas nunca colidem, e
 * o teardown sabe exatamente o que remover mesmo se a rodada anterior
 * tiver morrido no meio.
 */
export function fixtureRunId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
