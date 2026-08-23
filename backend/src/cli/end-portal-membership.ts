import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbMembershipRepository } from "../modules/organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbOrganizationRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { EndMembershipService } from "../modules/organization/application/EndMembershipService.js";
import { PublicId as OrganizationPublicId } from "../modules/organization/domain/value-objects/PublicId.js";

/**
 * CLI de revogação de vínculo — P1D.1 (v0.7.x). CLI irmã de
 * `bootstrap-portal-membership.ts`, deliberadamente separada: criar e
 * encerrar são operações distintas, com riscos distintos, e uma flag
 * `--revoke` na CLI de criação convidaria ao erro de digitação mais
 * caro possível.
 *
 * **Encerra SOMENTE um `Membership`, identificado pelo próprio
 * `publicId`.** Nunca toca `ApplicationAccess` (eixo independente,
 * ADR-031 §6), nunca toca `Organization`, `OrganizationRelationship`,
 * `OrganizationExternalReference` nem qualquer dado comercial de
 * sistema legado. Revogar o vínculo remove o alcance organizacional; o
 * acesso à aplicação, se precisar sair, sai por outro comando.
 *
 * **Encerrar não apaga:** a linha permanece com `status=INACTIVE` e
 * `ended_at` preenchido. O que muda é que ela deixa de compor o
 * `PortalContext` (que lê só `findActiveByIdentityPublicId`). O
 * histórico fica em `audit_events`, via `membership.updated`.
 *
 * **Imprime o vínculo ANTES de encerrar e exige que o operador confirme
 * pelo `--organization` esperado.** Um `publicId` de Membership é
 * opaco: sem essa dupla checagem, encerrar o vínculo errado é um erro
 * de copiar-e-colar. A CLI recusa se a Organization do Membership não
 * for a informada.
 *
 * **`--reason` é obrigatório** — vai para o payload de
 * `membership.updated` e daí para a trilha de auditoria. Uma revogação
 * sem motivo registrado é uma revogação que ninguém explica depois.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/end-portal-membership.js <membershipPublicId> \
 *        --organization <organizationPublicId> --reason "<motivo>" \
 *        [--execute --actor <identityPublicId>]
 *
 * Mesmo gate duplo das CLIs de bootstrap: escrita real exige
 * `--execute` E `--actor` E `BOOTSTRAP_ALLOW_WRITE=true`
 * simultaneamente; `NODE_ENV=production` recusa sempre. Sem
 * `--execute`, roda em dry-run: lê e mostra o que seria encerrado, sem
 * escrever nada.
 */

export interface CliArgs {
  readonly membershipPublicId: string;
  /** Organization que o operador AFIRMA ser a do vínculo — conferida antes de encerrar. */
  readonly expectedOrganizationPublicId: string;
  readonly reason: string;
  readonly execute: boolean;
  /** `undefined` é válido em dry-run — só exigido quando `execute=true`. */
  readonly actorPublicId: string | undefined;
}

function readOption(rest: readonly string[], nome: string): string | undefined {
  const indice = rest.indexOf(nome);
  if (indice < 0) {
    return undefined;
  }
  const valor = rest[indice + 1];
  if (valor === undefined || valor.startsWith("--")) {
    throw new Error(`${nome} exige um valor em seguida.`);
  }
  return valor;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [membershipPublicId, ...rest] = argv;
  const expectedOrganizationPublicId = readOption(rest, "--organization");
  const reason = readOption(rest, "--reason");
  if (membershipPublicId === undefined || expectedOrganizationPublicId === undefined || reason === undefined) {
    throw new Error(
      'Uso: end-portal-membership.js <membershipPublicId> --organization <organizationPublicId> ' +
        '--reason "<motivo>" [--execute --actor <identityPublicId>]'
    );
  }
  if (reason.trim().length === 0) {
    throw new Error("--reason não pode ser vazio.");
  }
  const actorPublicId = readOption(rest, "--actor");
  return {
    membershipPublicId,
    expectedOrganizationPublicId,
    reason,
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

/** Mesmo princípio de `evaluatePortalMembershipWriteGate` (CLI de criação). */
export function evaluateEndMembershipWriteGate(
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

/**
 * Confere que o Membership pertence à Organization que o operador
 * declarou. É a guarda contra encerrar o vínculo errado por
 * copiar-e-colar de um `publicId` opaco.
 */
export function conferirOrganizacaoEsperada(
  organizationPublicIdDoVinculo: string,
  esperada: string
): { readonly confere: true } | { readonly confere: false; readonly encontrada: string } {
  return organizationPublicIdDoVinculo === esperada
    ? { confere: true }
    : { confere: false, encontrada: organizationPublicIdDoVinculo };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const gateDecision = evaluateEndMembershipWriteGate(args, {
    nodeEnv: process.env["NODE_ENV"] ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true"
  });

  const env = loadEnv();
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });

  try {
    // Leitura e conferência acontecem SEMPRE — inclusive em dry-run.
    // É o que torna o dry-run útil: ele mostra exatamente o vínculo que
    // o `--execute` encerraria.
    const membershipRepository = new MariaDbMembershipRepository(pool);
    const organizationRepository = new MariaDbOrganizationRepository(pool);
    const membership = await membershipRepository.findByPublicId(
      OrganizationPublicId.fromString(args.membershipPublicId)
    );
    if (membership === undefined) {
      // eslint-disable-next-line no-console
      console.error(`[end-portal-membership] Membership não encontrado: ${args.membershipPublicId}`);
      process.exitCode = 2;
      return;
    }

    const conferencia = conferirOrganizacaoEsperada(
      membership.getOrganizationPublicId(),
      args.expectedOrganizationPublicId
    );
    if (!conferencia.confere) {
      // eslint-disable-next-line no-console
      console.error(
        `[end-portal-membership] Recusado: o vínculo pertence à Organization ${conferencia.encontrada}, ` +
          `não à informada em --organization (${args.expectedOrganizationPublicId}). Nada foi escrito.`
      );
      process.exitCode = 2;
      return;
    }

    const organization = await organizationRepository.findByPublicId(
      OrganizationPublicId.fromString(membership.getOrganizationPublicId())
    );
    // eslint-disable-next-line no-console
    console.log(
      `[end-portal-membership] Vínculo: ${membership.getPublicId().toString()}\n` +
        `  Identity     : ${membership.getIdentityPublicId()}\n` +
        `  Organization : ${membership.getOrganizationPublicId()} (${organization?.getTradeName()?.toString() ?? organization?.getLegalName().toString() ?? "?"})\n` +
        `  Profile      : ${membership.getProfile().toString()}\n` +
        `  Scope        : ${membership.getScope().toString()}\n` +
        `  Status       : ${membership.getStatus()}`
    );

    if (!gateDecision.allowed) {
      // eslint-disable-next-line no-console
      console.error(`[end-portal-membership] Dry-run (motivo: ${gateDecision.reason}). Nada foi escrito.`);
      process.exitCode = 2;
      return;
    }

    const endMembershipService = new EndMembershipService(
      new MariaDbUnitOfWork(pool),
      (connection) => new MariaDbMembershipRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const resultado = await endMembershipService.execute({
      membershipPublicId: args.membershipPublicId,
      reason: args.reason,
      actorPublicId: gateDecision.actorPublicId
    });
    // eslint-disable-next-line no-console
    console.log(
      `[end-portal-membership] Encerrado: ${resultado.publicId} ` +
        `(${resultado.previousStatus} → ${resultado.status}, ended_at=${resultado.endedAt})`
    );
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[end-portal-membership] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
