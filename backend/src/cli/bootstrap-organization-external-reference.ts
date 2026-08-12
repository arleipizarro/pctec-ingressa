import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbOrganizationRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateOrganizationExternalReferenceService } from "../modules/organization/application/CreateOrganizationExternalReferenceService.js";

/**
 * Micro-CLI administrativa — gap operacional encontrado na preparação
 * do piloto AFIP (Portal ↔ Ingressa): não havia forma de criar uma
 * `OrganizationExternalReference` isolada, real, usando o domínio, sem
 * SQL manual e sem recorrer a `bootstrap-organizations-from-legacy.ts`
 * (feito para lotes com matching por CNPJ — inadequado quando o
 * `organizationPublicId` e o `legacyId` já são conhecidos com certeza).
 *
 * Reaproveita `CreateOrganizationExternalReferenceService` (G2) sem
 * nenhuma alteração — mesma disciplina das demais CLIs de bootstrap.
 *
 * **PREPARADO nesta entrega, NÃO EXECUTADO.** Nenhum chamado real a
 * este CLI foi feito nesta rodada — só typecheck/build/test.
 *
 * **`--actor` obrigatório em `--execute`, sem fallback** — mesmo
 * princípio já revisado e aplicado em `bootstrap-organization.ts`.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-organization-external-reference.js <organizationPublicId> <systemCode> <entityType> <legacyId> [--execute --actor <identityPublicId>]
 *
 * `systemCode`: validado pelo VO `SystemCode` dentro do service — só
 * `PCTEC_HUB`/`PCTEC_HELPDESK`/`PCTEC_PORTAL` (esta CLI nunca duplica
 * essa validação). `entityType`: string livre (nome real da
 * tabela/entidade legada, ex.: `clientes`, `clientes_grupo`).
 * `legacyId`: id numérico local do sistema legado — nunca vira
 * contrato cross-system (ADR-031); só existe para rastreabilidade.
 *
 * Mesmo gate duplo das demais CLIs de bootstrap: escrita real exige
 * `--execute` E `--actor` E `BOOTSTRAP_ALLOW_WRITE=true` simultaneamente;
 * `NODE_ENV=production` recusa sempre.
 */

export interface CliArgs {
  readonly organizationPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string;
  readonly execute: boolean;
  /** `undefined` é válido em dry-run — só é exigido quando `execute=true` (ver `evaluateExternalReferenceWriteGate`). */
  readonly actorPublicId: string | undefined;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [organizationPublicId, systemCode, entityType, legacyId, ...rest] = argv;
  if (
    organizationPublicId === undefined ||
    systemCode === undefined ||
    entityType === undefined ||
    legacyId === undefined
  ) {
    throw new Error(
      "Uso: bootstrap-organization-external-reference.js <organizationPublicId> <systemCode> <entityType> <legacyId> [--execute --actor <identityPublicId>]"
    );
  }

  const actorIndex = rest.indexOf("--actor");
  const actorPublicId = actorIndex >= 0 ? rest[actorIndex + 1] : undefined;
  if (actorIndex >= 0 && actorPublicId === undefined) {
    throw new Error("--actor exige um publicId em seguida.");
  }

  return {
    organizationPublicId,
    systemCode,
    entityType,
    legacyId,
    execute: rest.includes("--execute"),
    // NUNCA default silencioso — omitido é omitido; a exigência (só
    // quando execute=true) é responsabilidade do gate, não do parsing.
    actorPublicId
  };
}

export interface DestructiveGateEnv {
  readonly nodeEnv: string;
  readonly allowWriteEnvVar: boolean;
}

export type DestructiveGateDecision =
  | { readonly allowed: true; readonly actorPublicId: string }
  | {
      readonly allowed: false;
      readonly reason: "production" | "missing_execute_flag" | "missing_actor_for_execute" | "missing_env_var";
    };

/** Mesmo princípio de `evaluateOrganizationWriteGate` (bootstrap-organization.ts). */
export function evaluateExternalReferenceWriteGate(
  args: CliArgs,
  gateEnv: DestructiveGateEnv
): DestructiveGateDecision {
  if (gateEnv.nodeEnv === "production") {
    return { allowed: false, reason: "production" };
  }
  if (!args.execute) {
    return { allowed: false, reason: "missing_execute_flag" };
  }
  if (args.actorPublicId === undefined) {
    return { allowed: false, reason: "missing_actor_for_execute" };
  }
  if (!gateEnv.allowWriteEnvVar) {
    return { allowed: false, reason: "missing_env_var" };
  }
  return { allowed: true, actorPublicId: args.actorPublicId };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gateDecision = evaluateExternalReferenceWriteGate(args, {
    nodeEnv: process.env["NODE_ENV"] ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true"
  });

  if (!gateDecision.allowed) {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-organization-external-reference] Recusado (motivo: ${gateDecision.reason}). Nada foi escrito.`);
    process.exitCode = 2;
    return;
  }

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

    const createOrganizationExternalReferenceService = new CreateOrganizationExternalReferenceService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const result = await createOrganizationExternalReferenceService.execute({
      organizationPublicId: args.organizationPublicId,
      systemCode: args.systemCode,
      entityType: args.entityType,
      legacyId: args.legacyId,
      actorPublicId: gateDecision.actorPublicId
    });
    // eslint-disable-next-line no-console
    console.log(
      `[bootstrap-organization-external-reference] ExternalReference criada: ${result.publicId} (${result.systemCode}/${result.entityType} -> ${result.organizationPublicId})`
    );
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-organization-external-reference] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
