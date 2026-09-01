import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbIdentityExternalReferenceRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { SupersedeIdentityExternalReferenceService } from "../modules/identity/application/SupersedeIdentityExternalReferenceService.js";
import { SUPERSEDE_REASONS } from "../modules/identity/domain/value-objects/SupersedeReason.js";

/**
 * CLI operacional de correção de vínculo — fundação PCTEC Meu RH.
 *
 * **Existe para que nunca seja preciso `UPDATE` na mão.** Antes desta
 * entrega, corrigir uma `IdentityExternalReference` errada — a Identity
 * apontando para o registro de outra pessoa — só era possível com SQL
 * direto no banco: sem ator registrado, sem motivo, sem evento, e com
 * uma janela entre "desativar a antiga" e "ativar a nova" em que ou
 * havia duas referências ACTIVE, ou nenhuma. Este comando faz a mesma
 * correção em UMA transação, auditada.
 *
 * Reaproveita `SupersedeIdentityExternalReferenceService` sem nenhuma
 * alteração — mesma disciplina das demais CLIs desta base.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/supersede-identity-external-reference.js \
 *     <referencePublicId> \
 *     <reason> \
 *     [--replace-with-legacy-id <legacyId> --match-method <matchMethod>] \
 *     [--execute] \
 *     --actor <identityPublicId>
 *
 * `reason` é um dos valores fechados de `SupersedeReason`
 * (`MATCH_CORRECTION`, `SOURCE_RECORD_REPLACED`, `IDENTITY_OFFBOARDED`)
 * — nunca texto livre, para que o evento de auditoria, que é
 * append-only, jamais carregue dado pessoal digitado à mão.
 *
 * Escrita real exige simultaneamente:
 *   1. --execute
 *   2. BOOTSTRAP_ALLOW_WRITE=true
 *   3. --actor explícito
 *   4. NODE_ENV != production
 *
 * Dry-run (padrão, sem `--execute`): valida parsing e gates. Não acessa
 * banco, não escreve nada.
 *
 * **Nunca apaga.** Não existe flag de exclusão, aqui nem em lugar
 * nenhum: a referência superada permanece como histórico.
 */

export interface SupersedeCliArgs {
  readonly referencePublicId: string;
  readonly reason: string;
  readonly execute: boolean;
  readonly actorPublicId: string | undefined;
  readonly replacementLegacyId: string | undefined;
  readonly replacementMatchMethod: string | undefined;
}

const USO =
  "Uso: supersede-identity-external-reference <referencePublicId> <reason> " +
  "[--replace-with-legacy-id <legacyId> --match-method <matchMethod>] [--execute] --actor <identityPublicId>\n" +
  `reason aceita: ${SUPERSEDE_REASONS.join(" | ")}`;

export function parseArgs(argv: readonly string[]): SupersedeCliArgs {
  const posicionais: string[] = [];
  let execute = false;
  let actorPublicId: string | undefined;
  let replacementLegacyId: string | undefined;
  let replacementMatchMethod: string | undefined;

  for (let indice = 0; indice < argv.length; indice += 1) {
    const atual = argv[indice];
    if (atual === "--execute") {
      execute = true;
      continue;
    }
    if (atual === "--actor") {
      actorPublicId = argv[indice + 1];
      if (actorPublicId === undefined || actorPublicId.startsWith("--")) {
        throw new Error("--actor exige um valor.");
      }
      indice += 1;
      continue;
    }
    if (atual === "--replace-with-legacy-id") {
      replacementLegacyId = argv[indice + 1];
      if (replacementLegacyId === undefined || replacementLegacyId.startsWith("--")) {
        throw new Error("--replace-with-legacy-id exige um valor.");
      }
      indice += 1;
      continue;
    }
    if (atual === "--match-method") {
      replacementMatchMethod = argv[indice + 1];
      if (replacementMatchMethod === undefined || replacementMatchMethod.startsWith("--")) {
        throw new Error("--match-method exige um valor.");
      }
      indice += 1;
      continue;
    }
    if (atual !== undefined) {
      posicionais.push(atual);
    }
  }

  const [referencePublicId, reason] = posicionais;
  if (referencePublicId === undefined || reason === undefined) {
    throw new Error(USO);
  }
  // Substituição é tudo-ou-nada: um `legacyId` sem `matchMethod` deixaria
  // o service inferir COMO o vínculo novo foi confirmado, e essa decisão
  // é sempre de quem opera — nunca do código.
  if ((replacementLegacyId === undefined) !== (replacementMatchMethod === undefined)) {
    throw new Error("--replace-with-legacy-id e --match-method andam juntos: informe os dois ou nenhum.");
  }

  return { referencePublicId, reason, execute, actorPublicId, replacementLegacyId, replacementMatchMethod };
}

export interface SupersedeGateEnv {
  readonly nodeEnv: string;
  readonly allowWriteEnvVar: boolean;
}

export type SupersedeGateDecision =
  | { readonly allowed: true; readonly actorPublicId: string }
  | {
      readonly allowed: false;
      readonly reason: "production" | "missing_execute_flag" | "missing_actor_for_execute" | "missing_env_var";
    };

/** Mesmo gate, mesma ordem e mesmos motivos de `bootstrap-identity-external-reference`. */
export function evaluateSupersedeWriteGate(
  args: SupersedeCliArgs,
  gateEnv: SupersedeGateEnv
): SupersedeGateDecision {
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
  const gateDecision = evaluateSupersedeWriteGate(args, {
    nodeEnv: process.env["NODE_ENV"] ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true"
  });

  if (!gateDecision.allowed) {
    // eslint-disable-next-line no-console
    console.error(
      `[supersede-identity-external-reference] Recusado (motivo: ${gateDecision.reason}). Nada foi escrito.`
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
    const service = new SupersedeIdentityExternalReferenceService(
      new MariaDbUnitOfWork(pool),
      (connection) => new MariaDbIdentityExternalReferenceRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const resultado = await service.execute({
      referencePublicId: args.referencePublicId,
      reason: args.reason,
      actorPublicId: gateDecision.actorPublicId,
      ...(args.replacementLegacyId !== undefined && args.replacementMatchMethod !== undefined
        ? { replacement: { legacyId: args.replacementLegacyId, matchMethod: args.replacementMatchMethod } }
        : {})
    });
    // eslint-disable-next-line no-console
    console.log(
      `[supersede-identity-external-reference] superada: ${resultado.supersededPublicId}` +
        (resultado.replacementPublicId === undefined
          ? " (sem substituicao — o vinculo deixou de existir)"
          : ` -> substituida por: ${resultado.replacementPublicId}`)
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
      `[supersede-identity-external-reference] ERRO: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}
