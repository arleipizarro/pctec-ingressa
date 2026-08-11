import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbApplicationRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { GrantApplicationAccessService } from "../modules/application/application/GrantApplicationAccessService.js";
import { PCTEC_PORTAL_APPLICATION_CODE } from "../modules/application/domain/value-objects/ApplicationCodes.js";

/**
 * CLI de bootstrap DEV — G3.1 (v0.6.x), microcorreção pós-homologação
 * de G3.
 *
 * **Correção de escopo (G3.1): esta CLI concede SOMENTE
 * `ApplicationAccess(PCTEC_PORTAL, USER)` — nunca cria `Membership`.**
 * A versão original (G3) exigia `organizationPublicId`/`profile`/
 * `scope` e criava os dois juntos, na mesma chamada — isso violava a
 * decisão arquitetural já formalizada (ADR-031 §6, reafirmada em G3):
 * `ApplicationAccess != Membership`, dois eixos independentes. Além de
 * incoerente com a própria arquitetura, isso tornava IMPOSSÍVEL provar
 * operacionalmente o contrato "PCTEC_PORTAL/USER válido + zero
 * Membership ACTIVE -> GET /api/v1/portal/context = 200
 * `organizations: []`" (G3, já testado em unit tests, mas nunca
 * demonstrável via bootstrap real, porque o único CLI disponível
 * sempre criava um Membership junto).
 *
 * Para criar um `Membership` (separadamente, e só quando de fato
 * necessário), usar `bootstrap-portal-membership.ts` — CLI irmã,
 * também preparada, nunca exige `ApplicationAccess` como pré-condição
 * (os dois comandos são deliberadamente independentes, mesmo princípio
 * do domínio: `CreateMembershipService` nunca consultou
 * `ApplicationAccess`).
 *
 * **PREPARADO nesta entrega, NÃO EXECUTADO.** Nenhum chamado real a
 * este CLI foi feito nesta rodada — só typecheck/build.
 *
 * Reaproveita `GrantApplicationAccessService` (G3, genérico) — nenhuma
 * lógica de domínio nova aqui, só orquestração de CLI.
 *
 * **Nunca hardcode o Product Owner nem qualquer Identity específica**
 * — `identityPublicId` é argumento obrigatório, nunca valor fixo no
 * código. Não é segredo (é identificador público, não senha), então
 * argumento de linha de comando é aceitável aqui — diferente do CLI de
 * bootstrap fundacional (`bootstrap-first-admin-access.ts`), que evita
 * argv por outros dados sensíveis não estarem em jogo ali.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-portal-access.js <identityPublicId> [--execute] [--actor <publicId>]
 *
 * Mesmo gate duplo de `bootstrap-organizations-from-legacy.ts` (G2):
 * escrita real exige `--execute` E `BOOTSTRAP_ALLOW_WRITE=true`
 * simultaneamente; `NODE_ENV=production` recusa sempre.
 */

export interface CliArgs {
  readonly identityPublicId: string;
  readonly execute: boolean;
  readonly actorPublicId: string;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [identityPublicId, ...rest] = argv;
  if (identityPublicId === undefined) {
    throw new Error("Uso: bootstrap-portal-access.js <identityPublicId> [--execute] [--actor <publicId>]");
  }
  const actorIndex = rest.indexOf("--actor");
  const actorPublicId = actorIndex >= 0 ? rest[actorIndex + 1] : undefined;
  if (actorIndex >= 0 && actorPublicId === undefined) {
    throw new Error("--actor exige um publicId em seguida.");
  }
  return {
    identityPublicId,
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
    // eslint-disable-next-line no-console
    console.log(
      "[bootstrap-portal-access] Nenhum Membership foi criado (fora do escopo desta CLI, por design — G3.1). " +
        "Use bootstrap-portal-membership.js separadamente, se necessário."
    );
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
