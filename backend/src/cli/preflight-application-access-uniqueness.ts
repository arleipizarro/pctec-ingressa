import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";

/**
 * Preflight da migration 0017 — v0.8.x.
 *
 * A migration 0017 cria `uk_app_access_active_grant`, garantindo no
 * banco no máximo um `ApplicationAccess` GRANTED por
 * (identity, application). Se já existirem duplicatas, o `ALTER TABLE`
 * falha com ER_DUP_ENTRY e a mensagem crua do MariaDB **não diz quais
 * linhas colidem** — o operador fica sem saber o que corrigir.
 *
 * Este CLI roda ANTES e responde exatamente isso.
 *
 * Por que um CLI e não um segundo statement na migration: o runner
 * exige UMA instrução executável por arquivo (`assertSingleStatement`),
 * regra que existe para manter as migrations revisáveis por um DBA. Um
 * bloco de diagnóstico não cabe lá — e nem deveria: diagnóstico não é
 * mudança de schema.
 *
 * **Somente leitura.** Não altera nada, em nenhuma circunstância.
 *
 * Saída:
 *   0 — nenhuma duplicata; a 0017 pode ser aplicada
 *   1 — duplicatas encontradas; corrija antes
 *   2 — erro de execução (conexão, permissão)
 *
 * Uso:
 *   node dist/cli/preflight-application-access-uniqueness.js
 */

interface DuplicateRow {
  readonly identity_public_id: string;
  readonly application_public_id: string;
  readonly total: number;
  readonly profiles: string;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export async function runPreflight(): Promise<number> {
  const env = loadEnv();
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });

  try {
    const [rows] = await pool.execute(
      `SELECT identity_public_id,
              application_public_id,
              COUNT(*)                        AS total,
              GROUP_CONCAT(DISTINCT access_profile ORDER BY access_profile) AS profiles
         FROM application_accesses
        WHERE status = 'GRANTED'
        GROUP BY identity_public_id, application_public_id
       HAVING COUNT(*) > 1
        ORDER BY total DESC`,
      []
    );

    const duplicates = rows as unknown as DuplicateRow[];

    if (duplicates.length === 0) {
      log("[preflight] OK — nenhum ApplicationAccess GRANTED duplicado por (identity, application).");
      log("[preflight] A migration 0017 pode ser aplicada.");
      return 0;
    }

    log(`[preflight] FALHA — ${duplicates.length} combinação(ões) com mais de um acesso GRANTED:`);
    for (const row of duplicates) {
      log(
        `  identity=${row.identity_public_id} application=${row.application_public_id} ` +
          `acessos=${row.total} perfis=${row.profiles}`
      );
    }
    log("");
    log("[preflight] A regra passa a ser UM acesso ativo por identidade por aplicação.");
    log("[preflight] Revogue os excedentes (mantendo o correto) antes de aplicar a 0017.");
    log("[preflight] Nenhuma alteração foi feita por este comando.");
    return 1;
  } finally {
    await pool.end();
  }
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runPreflight()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[preflight] erro: ${message}\n`);
      process.exitCode = 2;
    });
}
