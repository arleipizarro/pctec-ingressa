import type { Server } from "node:http";
import type { Queryable } from "../../../../shared/database/Queryable.js";

/**
 * Suporte para testes de integração da Identity Query API —
 * DELIBERADAMENTE sem nenhuma dependência de `MigrationRunner`,
 * `applyPending`, ou qualquer operação de schema (`CREATE`/`ALTER`/
 * `DROP`). O schema (tabelas `identities`, `audit_events`) é
 * PRÉ-CONDIÇÃO destes testes, nunca preparado implicitamente por eles —
 * ver causa raiz do bug real corrigido nesta entrega:
 * `pctec_ingressa_dev_app` (usuário runtime) não tem `CREATE`, e não
 * deveria — a falha anterior (`CREATE command denied`) comprovava que o
 * princípio de menor privilégio estava funcionando corretamente; o erro
 * estava no teste, que tentava preparar schema com o usuário errado.
 */

/**
 * Verifica, de forma estritamente READ-ONLY (só `SELECT` contra
 * `information_schema.tables`), que as tabelas necessárias já existem.
 * Nunca cria, altera ou remove nada. Lança um erro com mensagem clara se
 * alguma tabela estiver ausente — orientando rodar as migrations
 * separadamente (com o usuário migrator, fora deste teste), nunca
 * tentando prepará-las aqui.
 */
export async function assertIntegrationSchemaReady(
  connection: Queryable,
  requiredTables: readonly string[] = ["identities", "audit_events"]
): Promise<void> {
  for (const table of requiredTables) {
    // eslint-disable-next-line no-await-in-loop -- poucas tabelas, ordem não importa, mantém simplicidade.
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
      [table]
    );
    const total = Number((rows as Array<Record<string, unknown>>)[0]?.["total"] ?? 0);
    if (total === 0) {
      throw new Error(
        `Integration schema is not prepared; run migrations separately. Tabela ausente: "${table}".`
      );
    }
  }
}

/** Estado mutável do teste de integração — cada campo só é preenchido se aquele passo do setup teve sucesso. */
export interface IntegrationTestState {
  server?: Server;
  pool?: { execute: Queryable["execute"]; end: () => Promise<void> };
  fixturePublicId?: string;
}

/**
 * Limpeza robusta e tolerante a setup PARCIAL — nunca assume que
 * `state.server`/`state.pool` existem. Cada etapa roda independente das
 * outras (uma falhando não impede as demais de tentar), e NENHUM erro de
 * limpeza é relançado (o que mascararia o erro original do teste/setup)
 * — erros de limpeza só são logados. Idempotente: chamar duas vezes não
 * lança e não tem efeito colateral adicional na segunda vez (o
 * `DELETE`/`close`/`end` de algo já fechado/removido simplesmente não
 * encontra nada para fazer).
 */
export async function cleanupIntegrationTest(state: IntegrationTestState): Promise<void> {
  const errors: unknown[] = [];

  if (state.server !== undefined) {
    try {
      await new Promise<void>((resolve, reject) => {
        state.server!.close((err) => (err ? reject(err) : resolve()));
      });
    } catch (error) {
      errors.push(error);
    }
  }

  if (state.pool !== undefined && state.fixturePublicId !== undefined) {
    try {
      // Chave específica e fixa — nunca um DELETE genérico.
      await state.pool.execute(`DELETE FROM identities WHERE public_id = ?`, [state.fixturePublicId]);
    } catch (error) {
      errors.push(error);
    }
  }

  if (state.pool !== undefined) {
    try {
      await state.pool.end();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    // eslint-disable-next-line no-console -- nunca relança (mascararia o erro original), mas também nunca esconde silenciosamente.
    console.error(`[cleanupIntegrationTest] ${errors.length} erro(s) durante a limpeza (não mascara o erro original do teste):`, errors);
  }
}
