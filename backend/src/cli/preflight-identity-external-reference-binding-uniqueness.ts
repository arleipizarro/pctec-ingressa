import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";

/**
 * Preflight da migration 0024 — fundação PCTEC Meu RH.
 *
 * A 0024 cria `uk_id_ext_ref_active_binding`, garantindo no banco no
 * máximo UMA `IdentityExternalReference` ACTIVE por
 * `(identity_public_id, system_code, entity_type)`. Se já existirem
 * duplicatas, o `ALTER TABLE` falha com ER_DUP_ENTRY e a mensagem crua
 * do MariaDB **não diz quais linhas colidem** — o operador fica sem
 * saber o que corrigir.
 *
 * Este CLI roda ANTES e responde exatamente isso. Mesmo padrão do
 * preflight da 0017, pelo mesmo motivo: o runner exige UMA instrução
 * executável por arquivo de migration (`assertSingleStatement`), regra
 * que existe para manter as migrations revisáveis por um DBA — um bloco
 * de diagnóstico não cabe lá, e diagnóstico não é mudança de schema.
 *
 * **Somente leitura.** Não altera nada, em nenhuma circunstância.
 *
 * Também imprime o panorama pedido pela FASE 6 da task: total de
 * referências, quantas ACTIVE, quantas SUPERSEDED, e as duplicidades.
 *
 * Saída:
 *   0 — nenhuma duplicata; a 0024 pode ser aplicada
 *   1 — duplicatas encontradas; corrija antes (via supersede, nunca DELETE)
 *   2 — erro de execução (conexão, permissão)
 *
 * Uso:
 *   node dist/cli/preflight-identity-external-reference-binding-uniqueness.js
 */

export interface BindingDuplicateRow {
  readonly identity_public_id: string;
  readonly system_code: string;
  readonly entity_type: string;
  readonly total: number;
}

export interface BindingStatusRow {
  readonly status: string;
  readonly total: number;
}

/**
 * Formatação separada da consulta, para ser testável sem banco —
 * mesma decisão já praticada pelos CLIs de bootstrap, que exportam suas
 * funções puras.
 */
export function formatPreflightReport(
  statusRows: readonly BindingStatusRow[],
  duplicates: readonly BindingDuplicateRow[]
): { readonly lines: readonly string[]; readonly exitCode: number } {
  const total = statusRows.reduce((soma, linha) => soma + Number(linha.total), 0);
  const porStatus = new Map(statusRows.map((linha) => [linha.status, Number(linha.total)]));

  const lines: string[] = [
    `[preflight] total de referencias: ${total}`,
    `[preflight] ACTIVE: ${porStatus.get("ACTIVE") ?? 0}`,
    `[preflight] SUPERSEDED: ${porStatus.get("SUPERSEDED") ?? 0}`,
    `[preflight] duplicidades ACTIVE por (identity_public_id, system_code, entity_type): ${duplicates.length}`
  ];

  if (duplicates.length === 0) {
    lines.push("[preflight] OK — nenhuma duplicidade. A migration 0024 pode ser aplicada.");
    return { lines, exitCode: 0 };
  }

  lines.push("[preflight] FALHA — as combinacoes abaixo tem mais de uma referencia ACTIVE:");
  for (const linha of duplicates) {
    lines.push(
      `  identity=${linha.identity_public_id} system=${linha.system_code} ` +
        `entity=${linha.entity_type} ativas=${linha.total}`
    );
  }
  lines.push("");
  lines.push("[preflight] A regra passa a ser UM vinculo ativo por identidade por sistema/entidade.");
  lines.push("[preflight] Corrija por SUPERSEDE (lifecycle do dominio) — NUNCA por DELETE:");
  lines.push("[preflight] apagar a linha destroi o historico de como o vinculo errado surgiu.");
  lines.push("[preflight] Nenhuma alteracao foi feita por este comando.");
  return { lines, exitCode: 1 };
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
    const [statusRows] = await pool.execute(
      `SELECT status, COUNT(*) AS total
         FROM identity_external_references
        GROUP BY status`,
      []
    );
    const [duplicateRows] = await pool.execute(
      `SELECT identity_public_id,
              system_code,
              entity_type,
              COUNT(*) AS total
         FROM identity_external_references
        WHERE status = 'ACTIVE'
        GROUP BY identity_public_id, system_code, entity_type
       HAVING COUNT(*) > 1
        ORDER BY total DESC`,
      []
    );

    const relatorio = formatPreflightReport(
      statusRows as unknown as BindingStatusRow[],
      duplicateRows as unknown as BindingDuplicateRow[]
    );
    for (const linha of relatorio.lines) {
      log(linha);
    }
    return relatorio.exitCode;
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
