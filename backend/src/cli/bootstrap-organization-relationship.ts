import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbOrganizationRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationRelationshipRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRelationshipRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateOrganizationRelationshipService } from "../modules/organization/application/CreateOrganizationRelationshipService.js";

/**
 * Micro-CLI administrativa — gap operacional encontrado na preparação
 * do piloto AFIP (Portal ↔ Ingressa): não havia forma de criar um
 * `OrganizationRelationship` (BUSINESS_GROUP → COMPANY) isolado, real,
 * usando o domínio, sem SQL manual.
 *
 * Reaproveita `CreateOrganizationRelationshipService` (G1) sem nenhuma
 * alteração — mesma disciplina das demais CLIs de bootstrap: nenhuma
 * lógica de domínio nova, só orquestração de CLI. A validação de tipo
 * (parent deve ser `BUSINESS_GROUP`, child deve ser `COMPANY`) continua
 * sendo feita inteiramente dentro do Application Service, nunca
 * duplicada aqui.
 *
 * **PREPARADO nesta entrega, NÃO EXECUTADO.** Nenhum chamado real a
 * este CLI foi feito nesta rodada — só typecheck/build/test.
 *
 * **`--actor` obrigatório em `--execute`, sem fallback** — mesmo
 * princípio já revisado e aplicado em `bootstrap-organization.ts`:
 * nunca um default silencioso para uma mutação real do Cadastro
 * Mestre. Em dry-run, `--actor` pode ser omitido.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-organization-relationship.js <parentOrganizationPublicId> <childOrganizationPublicId> [--execute --actor <identityPublicId>]
 *
 * Mesmo gate duplo das demais CLIs de bootstrap: escrita real exige
 * `--execute` E `--actor` E `BOOTSTRAP_ALLOW_WRITE=true` simultaneamente;
 * `NODE_ENV=production` recusa sempre.
 */

export interface CliArgs {
  readonly parentOrganizationPublicId: string;
  readonly childOrganizationPublicId: string;
  readonly execute: boolean;
  /** `undefined` é válido em dry-run — só é exigido quando `execute=true` (ver `evaluateRelationshipWriteGate`). */
  readonly actorPublicId: string | undefined;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [parentOrganizationPublicId, childOrganizationPublicId, ...rest] = argv;
  if (parentOrganizationPublicId === undefined || childOrganizationPublicId === undefined) {
    throw new Error(
      "Uso: bootstrap-organization-relationship.js <parentOrganizationPublicId> <childOrganizationPublicId> [--execute --actor <identityPublicId>]"
    );
  }

  const actorIndex = rest.indexOf("--actor");
  const actorPublicId = actorIndex >= 0 ? rest[actorIndex + 1] : undefined;
  if (actorIndex >= 0 && actorPublicId === undefined) {
    throw new Error("--actor exige um publicId em seguida.");
  }

  return {
    parentOrganizationPublicId,
    childOrganizationPublicId,
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
export function evaluateRelationshipWriteGate(args: CliArgs, gateEnv: DestructiveGateEnv): DestructiveGateDecision {
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
  const gateDecision = evaluateRelationshipWriteGate(args, {
    nodeEnv: process.env["NODE_ENV"] ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true"
  });

  if (!gateDecision.allowed) {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-organization-relationship] Recusado (motivo: ${gateDecision.reason}). Nada foi escrito.`);
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

    const createOrganizationRelationshipService = new CreateOrganizationRelationshipService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbOrganizationRelationshipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const result = await createOrganizationRelationshipService.execute({
      parentOrganizationPublicId: args.parentOrganizationPublicId,
      childOrganizationPublicId: args.childOrganizationPublicId,
      actorPublicId: gateDecision.actorPublicId
    });
    // eslint-disable-next-line no-console
    console.log(
      `[bootstrap-organization-relationship] Relationship criado: ${result.publicId} (${result.parentOrganizationPublicId} -> ${result.childOrganizationPublicId})`
    );
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-organization-relationship] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
