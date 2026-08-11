import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbOrganizationRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationDocumentMatchRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationDocumentMatchRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import {
  BootstrapOrganizationsService,
  type LegacyOrganizationRecord,
  type BootstrapOrganizationsResult
} from "../modules/organization/application/BootstrapOrganizationsService.js";

/**
 * CLI de bootstrap/importação de Organizations a partir de registros
 * legados (HUB/Helpdesk/Portal) — G2, v0.6.x.
 *
 * **PREPARADO nesta entrega, NÃO EXECUTADO contra dados reais.** Nenhum
 * chamado real a este CLI foi feito nesta rodada — só typecheck/build.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-organizations-from-legacy.js <arquivo.json> [--execute] [--create-if-unmatched] [--actor <publicId>]
 *
 * `<arquivo.json>`: array de `LegacyOrganizationRecord` (ver
 * `BootstrapOrganizationsService.ts`) — este CLI NUNCA se conecta a
 * HUB/Helpdesk/Portal diretamente (isso seria repetir o antipattern já
 * registrado como dívida arquitetural, ADR-031); os registros legados
 * precisam ser extraídos por outro processo (fora de escopo G2) e
 * fornecidos como arquivo.
 *
 * **Dry-run é o padrão** — sem `--execute`, o comando SEMPRE roda em
 * modo `dryRun: true`, nunca escreve, só imprime o relatório de
 * classificação. Executar de verdade exige DUAS condições simultâneas
 * (mesmo princípio de `evaluateDestructiveGate` em `migrate.ts`): o
 * argumento `--execute` E a variável de ambiente
 * `BOOTSTRAP_ALLOW_WRITE=true`. `NODE_ENV=production` recusa SEMPRE,
 * mesmo com as duas condições satisfeitas.
 *
 * `--create-if-unmatched`: equivalente a
 * `createOrganizationForUnmatched: true` (bootstrap primário, tipicamente
 * HUB). Omitido: registros UNMATCHED só são reportados como gap
 * (tipicamente Portal/Helpdesk, correlacionando contra Organizations já
 * bootstrapadas do HUB).
 */

export interface CliArgs {
  readonly inputFilePath: string;
  readonly execute: boolean;
  readonly createIfUnmatched: boolean;
  readonly actorPublicId: string;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [inputFilePath, ...rest] = argv;
  if (inputFilePath === undefined || inputFilePath.length === 0) {
    throw new Error(
      "Uso: bootstrap-organizations-from-legacy.js <arquivo.json> [--execute] [--create-if-unmatched] [--actor <publicId>]"
    );
  }
  const actorIndex = rest.indexOf("--actor");
  const actorPublicId = actorIndex >= 0 ? rest[actorIndex + 1] : undefined;
  if (actorIndex >= 0 && actorPublicId === undefined) {
    throw new Error("--actor exige um publicId em seguida.");
  }
  return {
    inputFilePath,
    execute: rest.includes("--execute"),
    createIfUnmatched: rest.includes("--create-if-unmatched"),
    actorPublicId: actorPublicId ?? "SYSTEM"
  };
}

export interface DestructiveGateEnv {
  readonly nodeEnv: string;
  readonly allowWriteEnvVar: boolean;
}

export type DestructiveGateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "production" | "missing_execute_flag" | "missing_env_var" };

/**
 * Mesmo princípio de `evaluateDestructiveGate` (migrate.ts): DUAS
 * condições simultâneas para escrever de verdade, `production` recusa
 * sempre. Se a decisão não for `allowed: true`, o CLI roda em dry-run
 * mesmo que `--execute` tenha sido passado — nunca escreve por engano.
 */
export function evaluateBootstrapWriteGate(args: CliArgs, gateEnv: DestructiveGateEnv): DestructiveGateDecision {
  if (gateEnv.nodeEnv === "production") {
    return { allowed: false, reason: "production" };
  }
  if (!args.execute) {
    return { allowed: false, reason: "missing_execute_flag" };
  }
  if (!gateEnv.allowWriteEnvVar) {
    return { allowed: false, reason: "missing_env_var" };
  }
  return { allowed: true };
}

export function loadLegacyRecords(inputFilePath: string): LegacyOrganizationRecord[] {
  const raw = readFileSync(inputFilePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Arquivo de entrada deve conter um array JSON de LegacyOrganizationRecord.");
  }
  return parsed as LegacyOrganizationRecord[];
}

export function formatReport(result: BootstrapOrganizationsResult): string {
  const lines = result.entries.map(
    (entry) =>
      `  [${entry.classification.padEnd(9)}] ${entry.systemCode}/${entry.entityType}/${entry.legacyId} — ${entry.reason}`
  );
  const summaryLine = `MATCHED=${result.summary.matched} UNMATCHED=${result.summary.unmatched} CONFLICT=${result.summary.conflict}`;
  return [
    `Modo: ${result.dryRun ? "DRY-RUN (nada foi escrito)" : "EXECUÇÃO REAL"}`,
    summaryLine,
    ...lines
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gateDecision = evaluateBootstrapWriteGate(args, {
    nodeEnv: process.env["NODE_ENV"] ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true"
  });
  const dryRun = !gateDecision.allowed;

  if (args.execute && dryRun) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bootstrap] --execute foi passado, mas a escrita foi bloqueada (motivo: ${
        !gateDecision.allowed ? gateDecision.reason : "desconhecido"
      }). Rodando em DRY-RUN.`
    );
  }

  const records = loadLegacyRecords(args.inputFilePath);
  const env = loadEnv();
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });

  try {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const service = new BootstrapOrganizationsService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationDocumentMatchRepository(connection),
      (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );

    const result = await service.execute({
      records,
      dryRun,
      createOrganizationForUnmatched: args.createIfUnmatched,
      actorPublicId: args.actorPublicId
    });

    // eslint-disable-next-line no-console
    console.log(formatReport(result));
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
