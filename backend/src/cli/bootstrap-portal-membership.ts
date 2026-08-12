import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbOrganizationRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbMembershipRepository } from "../modules/organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateMembershipService } from "../modules/organization/application/CreateMembershipService.js";

/**
 * CLI de bootstrap DEV — G3.1 (v0.6.x). CLI irmã de
 * `bootstrap-portal-access.ts`, deliberadamente separada (não uma
 * flag opcional na mesma CLI) — reforça na ferramenta a mesma decisão
 * arquitetural já formalizada no domínio: `ApplicationAccess !=
 * Membership` (ADR-031 §6). Dois comandos independentes, dois CLIs
 * independentes.
 *
 * Cria SOMENTE um `Membership` (`Identity` <-> `Organization`) — nunca
 * consulta, exige ou concede `ApplicationAccess`. Mesmo princípio já
 * documentado em `CreateMembershipService.ts`: o domínio nunca tratou
 * os dois como acoplados; este CLI só deixou de refletir isso até esta
 * correção.
 *
 * **PREPARADO nesta entrega, NÃO EXECUTADO.** Nenhum chamado real a
 * este CLI foi feito nesta rodada — só typecheck/build.
 *
 * **Nunca hardcode Identity/Organization** — ambos são argumentos
 * obrigatórios, nunca valores fixos no código.
 *
 * **`--actor` obrigatório em `--execute`, sem fallback (correção,
 * piloto AFIP)** — a versão original desta CLI usava
 * `identityPublicId` como seu próprio actor por padrão quando `--actor`
 * era omitido. Isso não é auto-atribuição correta para trilha de
 * auditoria administrativa: quem de fato roda o comando (um
 * administrador) pode não ser a Identity beneficiada pelo Membership —
 * atribuir a ação a ela por default mascararia quem realmente agiu.
 * Mesmo princípio já revisado e aplicado em `bootstrap-organization.ts`:
 * nunca um default silencioso para uma mutação real do Cadastro Mestre.
 * Em dry-run, `--actor` pode ser omitido (nada é escrito, não há o que
 * auditar).
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-portal-membership.js <identityPublicId> <organizationPublicId> <profile> <scope> [--execute --actor <identityPublicId>]
 *
 * Mesmo gate duplo de `bootstrap-portal-access.ts`/
 * `bootstrap-organizations-from-legacy.ts` (G2): escrita real exige
 * `--execute` E `--actor` E `BOOTSTRAP_ALLOW_WRITE=true` simultaneamente;
 * `NODE_ENV=production` recusa sempre.
 */

export interface CliArgs {
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly profile: string;
  readonly scope: string;
  readonly execute: boolean;
  /** `undefined` é válido em dry-run — só é exigido quando `execute=true` (ver `evaluatePortalMembershipWriteGate`). */
  readonly actorPublicId: string | undefined;
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
      "Uso: bootstrap-portal-membership.js <identityPublicId> <organizationPublicId> <profile> <scope> [--execute --actor <identityPublicId>]"
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
    // NUNCA default silencioso (nem "SYSTEM", nem identityPublicId) —
    // omitido é omitido; a exigência (só quando execute=true) é
    // responsabilidade do gate, não do parsing.
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
export function evaluatePortalMembershipWriteGate(
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
  const gateDecision = evaluatePortalMembershipWriteGate(args, {
    nodeEnv: process.env["NODE_ENV"] ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true"
  });

  if (!gateDecision.allowed) {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-portal-membership] Recusado (motivo: ${gateDecision.reason}). Nada foi escrito.`);
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
      actorPublicId: gateDecision.actorPublicId
    });
    // eslint-disable-next-line no-console
    console.log(`[bootstrap-portal-membership] Membership criado: ${membershipResult.publicId}`);
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-portal-membership] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
