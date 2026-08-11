import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbApplicationRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbOrganizationRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbMembershipRepository } from "../modules/organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { GrantApplicationAccessService } from "../modules/application/application/GrantApplicationAccessService.js";
import { CreateMembershipService } from "../modules/organization/application/CreateMembershipService.js";
import { PCTEC_PORTAL_APPLICATION_CODE } from "../modules/application/domain/value-objects/ApplicationCodes.js";

/**
 * CLI de bootstrap DEV — G3 (v0.6.x), task seção 24: "concessão
 * PCTEC_PORTAL para uma Identity selecionada + Membership de
 * teste/fixture". **PREPARADO nesta entrega, NÃO EXECUTADO.** Nenhum
 * chamado real a este CLI foi feito nesta rodada — só typecheck/build.
 *
 * Reaproveita `GrantApplicationAccessService` (G3, genérico) +
 * `CreateMembershipService` (G2, já existente) — nenhuma lógica de
 * domínio nova aqui, só orquestração de CLI.
 *
 * **Nunca hardcode o Product Owner nem qualquer Identity específica**
 * (task, seção 24) — `identityPublicId`/`organizationPublicId` são
 * argumentos obrigatórios, nunca valores fixos no código. Não são
 * segredos (são identificadores públicos, não senhas), então argumentos
 * de linha de comando são aceitáveis aqui — diferente do CLI de
 * bootstrap fundacional (`bootstrap-first-admin-access.ts`), que evita
 * argv por outros dados sensíveis não estarem em jogo ali.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-portal-access.js <identityPublicId> <organizationPublicId> <profile> <scope> [--execute] [--actor <publicId>]
 *
 * Mesmo gate duplo de `bootstrap-organizations-from-legacy.ts` (G2):
 * escrita real exige `--execute` E `BOOTSTRAP_ALLOW_WRITE=true`
 * simultaneamente; `NODE_ENV=production` recusa sempre.
 */

export interface CliArgs {
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly profile: string;
  readonly scope: string;
  readonly execute: boolean;
  readonly actorPublicId: string;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [identityPublicId, organizationPublicId, profile, scope, ...rest] = argv;
  if (
    identityPublicId === undefined ||
    organizationPublicId === undefined ||
    profile === undefined ||
    scope === undefined
  ) {
    throw new Error(
      "Uso: bootstrap-portal-access.js <identityPublicId> <organizationPublicId> <profile> <scope> [--execute] [--actor <publicId>]"
    );
  }
  const actorIndex = rest.indexOf("--actor");
  const actorPublicId = actorIndex >= 0 ? rest[actorIndex + 1] : undefined;
  if (actorIndex >= 0 && actorPublicId === undefined) {
    throw new Error("--actor exige um publicId em seguida.");
  }
  return {
    identityPublicId,
    organizationPublicId,
    profile,
    scope,
    execute: rest.includes("--execute"),
    actorPublicId: actorPublicId ?? identityPublicId
  };
}

export interface DestructiveGateEnv {
  readonly nodeEnv: string;
  readonly allowWriteEnvVar: boolean;
}

export type DestructiveGateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "production" | "missing_execute_flag" | "missing_env_var" };

/** Mesmo princípio de `evaluateBootstrapWriteGate` (G2) / `evaluateDestructiveGate` (migrate.ts). */
export function evaluatePortalAccessWriteGate(args: CliArgs, gateEnv: DestructiveGateEnv): DestructiveGateDecision {
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gateDecision = evaluatePortalAccessWriteGate(args, {
    nodeEnv: process.env["NODE_ENV"] ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true"
  });

  if (!gateDecision.allowed) {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-portal-access] Recusado (motivo: ${gateDecision.reason}). Nada foi escrito.`);
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

    const grantApplicationAccessService = new GrantApplicationAccessService(
      unitOfWork,
      (connection) => new MariaDbApplicationRepository(connection),
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbApplicationAccessRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const accessResult = await grantApplicationAccessService.execute({
      identityPublicId: args.identityPublicId,
      applicationCode: PCTEC_PORTAL_APPLICATION_CODE,
      accessProfile: "USER",
      grantedByIdentityPublicId: args.actorPublicId
    });
    // eslint-disable-next-line no-console
    console.log(`[bootstrap-portal-access] ApplicationAccess concedido: ${accessResult.applicationAccessPublicId}`);

    const createMembershipService = new CreateMembershipService(
      unitOfWork,
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbMembershipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const membershipResult = await createMembershipService.execute({
      identityPublicId: args.identityPublicId,
      organizationPublicId: args.organizationPublicId,
      profile: args.profile,
      scope: args.scope,
      actorPublicId: args.actorPublicId
    });
    // eslint-disable-next-line no-console
    console.log(`[bootstrap-portal-access] Membership criado: ${membershipResult.publicId}`);
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-portal-access] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
