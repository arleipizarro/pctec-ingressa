import { hostname } from "node:os";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  PRODUCTION_BOOTSTRAP_AUTHORIZATION_VARIABLE,
  normalizeConfirmation,
  resolveBootstrapCeremony,
  type ProductionBootstrapContext
} from "./productionBootstrapGuard.js";

import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbOrganizationRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import {
  CreateOrganizationExternalReferenceService,
  type CreateOrganizationExternalReferenceRequest,
  type CreateOrganizationExternalReferenceResult
} from "../modules/organization/application/CreateOrganizationExternalReferenceService.js";

/**
 * Micro-CLI administrativa — gap operacional encontrado na preparação
 * do piloto AFIP (Portal ↔ Ingressa): não havia forma de criar uma
 * `OrganizationExternalReference` isolada, real, usando o domínio, sem
 * SQL manual e sem recorrer a `bootstrap-organizations-from-legacy.ts`
 * (feito para lotes com matching por CNPJ — inadequado quando o
 * `organizationPublicId` e o `legacyId` já são conhecidos com certeza).
 *
 * Reaproveita `CreateOrganizationExternalReferenceService` (G2) sem
 * nenhuma alteração — mesma disciplina das demais CLIs de bootstrap:
 * `UnitOfWork` e repositórios oficiais, auditoria do domínio, nenhuma
 * query `INSERT`/`UPDATE`/`DELETE` escrita aqui.
 *
 * **`--actor` obrigatório em `--execute`, sem fallback** — mesmo
 * princípio já revisado e aplicado em `bootstrap-organization.ts`.
 *
 * ## Uso (depois de `npm run build`, a partir de `backend/`)
 *
 * Dry-run — funciona em QUALQUER ambiente, inclusive produção. Não
 * carrega `.env`, não abre conexão, não escreve nada:
 *
 *   node dist/cli/bootstrap-organization-external-reference.js \
 *     <organizationPublicId> <systemCode> <entityType> <legacyId>
 *
 * Escrita real FORA de produção — a configuração vem de `.env` pelo
 * `--env-file` do próprio Node (nunca de um `export` solto no shell, que
 * deixaria a credencial no histórico e no ambiente das próximas
 * execuções):
 *
 *   BOOTSTRAP_ALLOW_WRITE=true \
 *     node --env-file=.env dist/cli/bootstrap-organization-external-reference.js \
 *     <organizationPublicId> <systemCode> <entityType> <legacyId> \
 *     --execute --actor <identityPublicId>
 *
 * Escrita real EM PRODUÇÃO — mesma linha, mais a autorização temporária
 * do ADR-027, e sempre em terminal interativo real:
 *
 *   BOOTSTRAP_ALLOW_WRITE=true INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP=YES \
 *     node --env-file=.env dist/cli/bootstrap-organization-external-reference.js \
 *     <organizationPublicId> <systemCode> <entityType> <legacyId> \
 *     --execute --actor <identityPublicId>
 *
 * `BOOTSTRAP_ALLOW_WRITE` e `INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP` vão
 * SEMPRE na própria linha de comando, nunca no `.env` carregado pelo
 * `--env-file`: no `.env` elas deixariam de ser cerimônia e virariam
 * configuração permanente — exatamente o que estas barreiras existem
 * para impedir (ADR-027).
 *
 * `systemCode`: validado pelo VO `SystemCode` dentro do service — só
 * `PCTEC_HUB`/`PCTEC_HELPDESK`/`PCTEC_PORTAL` (esta CLI nunca duplica
 * essa validação). `entityType`: string livre (nome real da
 * tabela/entidade legada, ex.: `clientes`, `clientes_grupo`).
 * `legacyId`: id numérico local do sistema legado — nunca vira
 * contrato cross-system (ADR-031); só existe para rastreabilidade.
 *
 * ## Barreiras
 *
 * Em qualquer ambiente, escrita real exige `--execute` E `--actor` E
 * `BOOTSTRAP_ALLOW_WRITE=true` simultaneamente. Em produção, mais três,
 * todas fail-closed e reaproveitadas de `productionBootstrapGuard`
 * (ADR-027): autorização temporária no processo, TTY real e frase de
 * confirmação que nomeia database e hostname alvo.
 *
 * Sem `--execute` a CLI é um dry-run verdadeiro: imprime só
 * identificadores técnicos e termina antes de qualquer `createPool`.
 *
 * ## Exit codes
 *
 *   0 — dry-run concluído, ou referência criada com sucesso.
 *   1 — cancelado pelo operador, argumentos inválidos, ou falha na criação.
 *   2 — recusado pelo gate de escrita ou pela cerimônia de produção.
 */

const CONFIRMATION_PHRASE = "LINK_ORGANIZATION_EXTERNAL_REFERENCE";

const PRODUCTION_NODE_ENV = "production";

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

/**
 * `nodeEnv` NÃO entra aqui de propósito: produção deixou de ser uma
 * recusa deste gate e passou a ser a cerimônia do ADR-027
 * (`resolveExternalReferenceProductionCeremony`), que é uma barreira
 * separada e mais forte. Manter o campo aqui sem uso sugeriria que este
 * gate ainda decide alguma coisa sobre ambiente — não decide.
 */
export interface DestructiveGateEnv {
  readonly allowWriteEnvVar: boolean;
}

export type DestructiveGateDecision =
  | { readonly allowed: true; readonly actorPublicId: string }
  | {
      readonly allowed: false;
      readonly reason: "missing_execute_flag" | "missing_actor_for_execute" | "missing_env_var";
    };

/** Mesmo princípio de `evaluateOrganizationWriteGate` (bootstrap-organization.ts). */
export function evaluateExternalReferenceWriteGate(
  args: CliArgs,
  gateEnv: DestructiveGateEnv
): DestructiveGateDecision {
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

export function resolveExternalReferenceProductionCeremony(context: ProductionBootstrapContext) {
  return resolveBootstrapCeremony(CONFIRMATION_PHRASE, context);
}

export interface ExternalReferenceServiceLike {
  execute(
    request: CreateOrganizationExternalReferenceRequest
  ): Promise<CreateOrganizationExternalReferenceResult>;
}

/**
 * Serviço oficial já ligado a uma conexão real, com o encerramento
 * dessa conexão junto. Só nasce depois que TODAS as barreiras passaram —
 * é isto que garante, e permite testar, que dry-run, recusa e
 * cancelamento nunca abrem pool.
 */
export interface ExternalReferenceServiceSession {
  readonly service: ExternalReferenceServiceLike;
  readonly close: () => Promise<void>;
}

export interface ExternalReferenceCliDependencies {
  readonly args: CliArgs;
  readonly nodeEnv: string;
  readonly allowWriteEnvVar: boolean;
  /** `INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP` do processo — nunca lido do `.env`, nunca persistido. */
  readonly authorization: string | undefined;
  readonly databaseName: string;
  readonly hostname: string;
  /** `true` só com TTY real. Produção exige. */
  readonly interactive: boolean;
  readonly openService: () => ExternalReferenceServiceSession;
  readonly confirm: (confirmationPhrase: string) => Promise<string>;
  readonly log: (line: string) => void;
  readonly logError: (line: string) => void;
}

/**
 * Decisão da CLI separada de I/O real (readline/console) e de banco real
 * — mesma filosofia de `runBootstrapCli` (bootstrap-first-identity.ts) e
 * de `executeMigrateCommand` (migrate.ts): a suíte exercita produção,
 * cancelamento e execução autorizada sem TTY e sem MariaDB.
 */
export async function runExternalReferenceCli(deps: ExternalReferenceCliDependencies): Promise<number> {
  const { args } = deps;

  // Somente identificadores técnicos; nunca payload cadastral, nunca segredo.
  deps.log("[bootstrap-organization-external-reference] Plano:");
  deps.log(`  organizationPublicId: ${args.organizationPublicId}`);
  deps.log(`  referência: ${args.systemCode}/${args.entityType}/${args.legacyId}`);
  deps.log(`  modo: ${args.execute ? "EXECUTE" : "DRY-RUN"}`);

  if (!args.execute) {
    deps.log("[bootstrap-organization-external-reference] DRY-RUN concluído. Nada foi escrito.");
    return 0;
  }

  const gateDecision = evaluateExternalReferenceWriteGate(args, {
    allowWriteEnvVar: deps.allowWriteEnvVar
  });

  if (!gateDecision.allowed) {
    deps.logError(
      `[bootstrap-organization-external-reference] Recusado (motivo: ${gateDecision.reason}). Nada foi escrito.`
    );
    return 2;
  }

  // Sempre resolvida, em todo ambiente: um `NODE_ENV` desconhecido é
  // recusado aqui, em vez de escapar por um `if (production)` que não
  // cobre o caso.
  const ceremony = resolveExternalReferenceProductionCeremony({
    nodeEnv: deps.nodeEnv,
    authorization: deps.authorization,
    databaseName: deps.databaseName,
    hostname: deps.hostname,
    interactive: deps.interactive
  });

  if (!ceremony.allowed) {
    deps.logError(ceremony.message);
    return ceremony.exitCode;
  }

  const isProduction = deps.nodeEnv === PRODUCTION_NODE_ENV;

  if (isProduction) {
    for (const line of ceremony.preamble) {
      deps.log(line);
    }

    const confirmation = await deps.confirm(ceremony.confirmationPhrase);

    if (normalizeConfirmation(confirmation) !== ceremony.confirmationPhrase) {
      deps.log("Cancelado. Nenhuma conexão de escrita foi aberta, nenhuma referência foi criada.");
      return 1;
    }
  }

  const session = deps.openService();

  try {
    const result = await session.service.execute({
      organizationPublicId: args.organizationPublicId,
      systemCode: args.systemCode,
      entityType: args.entityType,
      legacyId: args.legacyId,
      actorPublicId: gateDecision.actorPublicId
    });
    deps.log(
      `[bootstrap-organization-external-reference] ExternalReference criada: ${result.publicId} (${result.systemCode}/${result.entityType} -> ${result.organizationPublicId})`
    );
    return 0;
  } catch (error) {
    // Em produção a mensagem do erro nunca é ecoada: ela pode carregar
    // SQL, nome de host, usuário de banco ou trecho de payload vindos do
    // driver. Fora de produção ela é útil e não expõe nada que o
    // operador já não tenha em mãos.
    deps.logError(
      isProduction
        ? "[bootstrap-organization-external-reference] Falha ao criar a referência externa. Nada foi confirmado."
        : `[bootstrap-organization-external-reference] ERRO: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  } finally {
    await session.close();
  }
}

async function confirmInteractive(confirmationPhrase: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(`Digite ${confirmationPhrase} para confirmar (qualquer outra coisa cancela): `);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Dry-run não carrega configuração nenhuma: sem `.env`, sem
  // `createPool`, sem chance de apontar para o banco errado. `loadEnv()`
  // só acontece quando já se sabe que a intenção é escrever.
  const env = args.execute ? loadEnv() : undefined;

  const exitCode = await runExternalReferenceCli({
    args,
    // Sem `env` carregado o ambiente é desconhecido, e desconhecido é
    // recusado pela cerimônia — fail-closed (inalcançável hoje: só o
    // dry-run roda sem `env`, e ele retorna antes).
    nodeEnv: env?.NODE_ENV ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true",
    // Autorização temporária: lida do ambiente DESTE processo, nunca do
    // `.env` — ver ADR-027.
    authorization: process.env[PRODUCTION_BOOTSTRAP_AUTHORIZATION_VARIABLE],
    databaseName: env?.DB_NAME ?? "",
    hostname: hostname(),
    interactive: stdin.isTTY === true,
    openService: () => {
      if (env === undefined) {
        throw new Error("Configuração não carregada — escrita impossível.");
      }
      const pool = createPool({
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER, // usuário runtime — NUNCA migrator
        password: env.DB_PASSWORD
      });
      const service = new CreateOrganizationExternalReferenceService(
        new MariaDbUnitOfWork(pool),
        (connection) => new MariaDbOrganizationRepository(connection),
        (connection) => new MariaDbOrganizationExternalReferenceRepository(connection),
        (connection) => new MariaDbAuditEventRepository(connection)
      );
      return {
        service,
        close: async () => {
          await pool.end();
        }
      };
    },
    confirm: confirmInteractive,
    // eslint-disable-next-line no-console
    log: (line) => console.log(line),
    // eslint-disable-next-line no-console
    logError: (line) => console.error(line)
  });

  process.exitCode = exitCode;
}

/**
 * Falhas ANTES do fluxo controlado — argumentos inválidos ou `.env`
 * ausente/inválido. Só mensagens de origem conhecida e curada são
 * ecoadas (o texto de uso de `parseArgs` e os gates de configuração de
 * `loadEnv`, que nomeiam variáveis mas nunca imprimem valores). Qualquer
 * outro erro — `ZodError`, driver, bug — vira mensagem genérica: em
 * produção uma mensagem crua pode carregar host, usuário de banco, SQL
 * ou stack, e aqui não há ambiente para diferenciar, porque a falha pode
 * ser justamente a de descobrir qual é o ambiente.
 */
export function describeStartupFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const isCurated =
    message.startsWith("Uso:") || message.startsWith("--actor") || message.startsWith("Configuração inválida:");

  return isCurated
    ? `[bootstrap-organization-external-reference] ${message}`
    : "[bootstrap-organization-external-reference] Falha inesperada antes de qualquer escrita. Nada foi escrito.";
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(describeStartupFailure(error));
    process.exitCode = 1;
  });
}
