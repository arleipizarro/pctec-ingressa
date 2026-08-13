import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbIdentityExternalReferenceRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateIdentityExternalReferenceService } from "../modules/identity/application/CreateIdentityExternalReferenceService.js";

/**
 * CLI de bootstrap administrativa — P1B.0 (v0.7.x).
 *
 * Cria um vínculo `IdentityExternalReference` entre uma `Identity`
 * canônica do Ingressa e um id legado de um sistema externo (HUB,
 * Helpdesk ou Portal). Gap operacional: sem este vínculo o Portal não
 * tem como resolver `portal_acesso.id` → `Identity.publicId` pelo
 * caminho service-to-service (P1A.1). Caso real: portal_acesso.id=33
 * e Identity 66231e51-... são a mesma pessoa com e-mails diferentes —
 * o matching por e-mail não é suficiente, o vínculo precisa ser
 * declarado explicitamente.
 *
 * Reaproveita `CreateIdentityExternalReferenceService` (Fatia 2) sem
 * nenhuma alteração — mesma disciplina das demais CLIs de bootstrap.
 *
 * **PREPARADO nesta entrega, NÃO EXECUTADO.** Nenhuma escrita real
 * foi feita nesta rodada — só typecheck/build/test.
 *
 * **`matchMethod` é obrigatório e nunca inferido automaticamente.**
 * Esta CLI apenas parseia o argumento e o repassa para o service/VO.
 * A autoridade de validação dos valores aceitos é `VO MatchMethod`
 * (`MATCHED_BY_EMAIL` | `MATCHED_MANUAL_CONFIRMED`). O valor
 * `MATCHED_MANUAL_CONFIRMED` já representa a decisão humana explícita;
 * não existe flag adicional como `--confirm-manual-match`.
 *
 * **`--actor` obrigatório em `--execute`, sem fallback** — nunca usa
 * `SYSTEM` implícito, nunca usa `identityPublicId` beneficiada como
 * fallback de actor. Em dry-run, `--actor` pode ser omitido.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-identity-external-reference.js \
 *     <identityPublicId> \
 *     <systemCode> \
 *     <entityType> \
 *     <legacyId> \
 *     <matchMethod> \
 *     [--execute] \
 *     --actor <identityPublicId>
 *
 * Escrita real exige simultaneamente:
 *   1. --execute
 *   2. BOOTSTRAP_ALLOW_WRITE=true
 *   3. --actor explícito
 *   4. NODE_ENV != production
 *   5. matchMethod explícito (validado pelo VO, não por esta CLI)
 *
 * Dry-run (padrão, sem --execute): valida parsing e gates operacionais.
 * Não acessa banco, não escreve nada.
 */

export interface CliArgs {
  readonly identityPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string;
  readonly matchMethod: string;
  readonly execute: boolean;
  /** `undefined` é válido em dry-run — só é exigido quando `execute=true` (ver `evaluateIdentityExternalReferenceWriteGate`). */
  readonly actorPublicId: string | undefined;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [identityPublicId, systemCode, entityType, legacyId, matchMethod, ...rest] = argv;
  if (
    identityPublicId === undefined ||
    systemCode === undefined ||
    entityType === undefined ||
    legacyId === undefined ||
    matchMethod === undefined
  ) {
    throw new Error(
      "Uso: bootstrap-identity-external-reference.js <identityPublicId> <systemCode> <entityType> <legacyId> <matchMethod> [--execute --actor <identityPublicId>]"
    );
  }

  const actorIndex = rest.indexOf("--actor");
  const actorPublicId = actorIndex >= 0 ? rest[actorIndex + 1] : undefined;
  if (actorIndex >= 0 && actorPublicId === undefined) {
    throw new Error("--actor exige um publicId em seguida.");
  }

  return {
    identityPublicId,
    systemCode,
    entityType,
    legacyId,
    matchMethod,
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
export function evaluateIdentityExternalReferenceWriteGate(
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
  const gateDecision = evaluateIdentityExternalReferenceWriteGate(args, {
    nodeEnv: process.env["NODE_ENV"] ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true"
  });

  if (!gateDecision.allowed) {
    // eslint-disable-next-line no-console
    console.error(
      `[bootstrap-identity-external-reference] Recusado (motivo: ${gateDecision.reason}). Nada foi escrito.`
    );
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

    const createIdentityExternalReferenceService = new CreateIdentityExternalReferenceService(
      unitOfWork,
      (connection) => new MariaDbIdentityRepository(connection),
      (connection) => new MariaDbIdentityExternalReferenceRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const result = await createIdentityExternalReferenceService.execute({
      identityPublicId: args.identityPublicId,
      systemCode: args.systemCode,
      entityType: args.entityType,
      legacyId: args.legacyId,
      matchMethod: args.matchMethod,
      actorPublicId: gateDecision.actorPublicId
    });
    // eslint-disable-next-line no-console
    console.log(
      `[bootstrap-identity-external-reference] IdentityExternalReference criada: ${result.publicId} (${result.systemCode}/${result.entityType} -> Identity ${result.identityPublicId})`
    );
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(
      `[bootstrap-identity-external-reference] ERRO: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}
