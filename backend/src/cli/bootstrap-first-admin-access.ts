import { createInterface } from "node:readline/promises";
import { hostname } from "node:os";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import {
  PRODUCTION_BOOTSTRAP_AUTHORIZATION_VARIABLE,
  normalizeConfirmation,
  resolveBootstrapCeremony
} from "./productionBootstrapGuard.js";

import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { PublicId as IdentityPublicId, InvalidPublicIdError } from "../modules/identity/domain/value-objects/PublicId.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { MariaDbApplicationRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import {
  BootstrapFirstApplicationAccessService,
  type BootstrapFirstApplicationAccessResult
} from "../modules/application/application/BootstrapFirstApplicationAccessService.js";
import {
  ApplicationAccessBootstrapAlreadyCompletedError,
  ApplicationAccessLockNotAcquiredError
} from "../modules/application/application/errors/ApplicationAccessBootstrapErrors.js";
import { ApplicationNotFoundError, IdentityNotFoundForAccessError } from "../modules/application/domain/errors/ApplicationErrors.js";
import { PCTEC_INGRESSA_APPLICATION_CODE, PCTEC_INGRESSA_APPLICATION_NAME } from "../modules/application/domain/value-objects/ApplicationCodes.js";

/**
 * CLI local, one-shot, da primeira concessão administrativa —
 * v0.5.0, `docs/adr/ADR-028-APPLICATION-ACCESS-E-ACESSO-ADMINISTRATIVO.md`.
 *
 * NUNCA abre socket. NUNCA aceita argumentos de linha de comando (entrada
 * 100% interativa via stdin — mesma razão do CLI de bootstrap de
 * Identity: elimina por completo "segredo em argv/ps/shell history").
 * Sempre concede exatamente PCTEC_INGRESSA + ADMIN — nunca aceita código
 * de aplicação nem perfil arbitrário como entrada.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-first-admin-access.js
 *
 * Exit codes (mesmo esquema do CLI de bootstrap de Identity):
 *   0 — concessão administrativa concluída com sucesso.
 *   1 — cancelado pelo operador, Identity não encontrada, bootstrap já
 *       concluído anteriormente, ou falha inesperada.
 *   2 — recusado por NODE_ENV não permitido (produção nesta fatia).
 *   3 — lock não adquirido (outro processo em execução).
 */

export interface AdminAccessCliInput {
  readonly identityPublicId: string;
}

export interface IdentitySummary {
  readonly publicId: string;
  readonly status: string;
  readonly maskedEmail: string;
}

export interface AdminAccessCliServiceLike {
  execute(request: { identityPublicId: string }): Promise<BootstrapFirstApplicationAccessResult>;
}

export interface AdminAccessCliDependencies {
  readonly nodeEnv: string;
  /** `INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP` — só relevante em produção (ADR-027). */
  readonly authorization?: string | undefined;
  /** `DB_NAME` efetivo — entra na frase de confirmação em produção. */
  readonly databaseName?: string;
  readonly hostname?: string;
  /** `true` quando há TTY real. Produção exige. */
  readonly interactive?: boolean;
  readonly collectInput: () => Promise<AdminAccessCliInput>;
  /** Busca a Identity para exibição prévia — leitura, fora da transação do serviço. Lança se não encontrada. */
  readonly findIdentity: (identityPublicId: string) => Promise<IdentitySummary>;
  readonly confirm: (confirmationPhrase: string) => Promise<string>;
  readonly service: AdminAccessCliServiceLike;
  readonly log: (line: string) => void;
  readonly logError: (line: string) => void;
}

const CONFIRMATION_PHRASE = "GRANT_ADMIN";

/** Mascara um e-mail — mesma implementação de `bootstrap-first-identity.ts`, nunca ecoa o valor completo. */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) {
    return "***";
  }
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  return `${localPart.charAt(0)}***@${domain}`;
}

/**
 * Lógica de decisão do CLI, separada de I/O real — testável com
 * dependências fake, sem terminal real e sem banco real. Mesma filosofia
 * de `bootstrap-first-identity.ts`/`migrate.ts`.
 */
export async function runAdminAccessBootstrapCli(deps: AdminAccessCliDependencies): Promise<number> {
  const ceremony = resolveBootstrapCeremony(CONFIRMATION_PHRASE, {
    nodeEnv: deps.nodeEnv,
    authorization: deps.authorization,
    databaseName: deps.databaseName ?? "",
    hostname: deps.hostname ?? "",
    interactive: deps.interactive ?? false
  });
  if (!ceremony.allowed) {
    deps.logError(ceremony.message);
    return ceremony.exitCode;
  }

  let input: AdminAccessCliInput;
  try {
    input = await deps.collectInput();
  } catch {
    deps.logError("Entrada inválida — identityPublicId é obrigatório. Nenhuma alteração foi feita.");
    return 1;
  }

  let identity: IdentitySummary;
  try {
    identity = await deps.findIdentity(input.identityPublicId);
  } catch {
    deps.logError("Identity não encontrada para o publicId informado. Nenhuma alteração foi feita.");
    return 1;
  }

  deps.log("Você está prestes a conceder a PRIMEIRA concessão administrativa da plataforma.");
  deps.log(`Identity encontrada — publicId: ${identity.publicId}`);
  deps.log(`E-mail: ${identity.maskedEmail}`);
  deps.log(`Status atual da Identity: ${identity.status} (não será alterado por esta operação)`);
  deps.log(`Aplicação: ${PCTEC_INGRESSA_APPLICATION_CODE} (${PCTEC_INGRESSA_APPLICATION_NAME})`);
  deps.log("Perfil: ADMIN");
  deps.log("Isto NÃO habilita login nem cria nenhuma Credential — apenas autorização de acesso global.");
  deps.log("Esta operação não pode ser desfeita por este CLI.");

  const confirmation = await deps.confirm(ceremony.confirmationPhrase);
  if (normalizeConfirmation(confirmation) !== ceremony.confirmationPhrase) {
    deps.log("Cancelado. Nenhuma conexão de escrita foi aberta, nenhum acesso foi concedido.");
    return 1;
  }

  try {
    const result = await deps.service.execute({ identityPublicId: input.identityPublicId });

    deps.log("Acesso administrativo concedido.");
    deps.log(`identityPublicId: ${result.identityPublicId}`);
    deps.log(`application: ${PCTEC_INGRESSA_APPLICATION_CODE}`);
    deps.log(`profile: ${result.accessProfile}`);
    return 0;
  } catch (error) {
    if (error instanceof ApplicationAccessBootstrapAlreadyCompletedError) {
      deps.logError("A primeira concessão administrativa já foi realizada anteriormente.");
      return 1;
    }
    if (error instanceof ApplicationAccessLockNotAcquiredError) {
      deps.logError("Não foi possível adquirir o lock — outro processo parece estar em execução.");
      return 3;
    }
    if (error instanceof ApplicationNotFoundError || error instanceof IdentityNotFoundForAccessError) {
      deps.logError("Application ou Identity não encontrada no momento da concessão. Nenhuma alteração foi confirmada.");
      return 1;
    }
    // Qualquer outro erro (bug, driver, etc.) — nunca vaza SQL, stack ou
    // valor de configuração na saída do CLI.
    deps.logError("Falha inesperada durante a concessão administrativa. Nenhuma alteração foi confirmada.");
    return 1;
  }
}

async function collectInputInteractive(): Promise<AdminAccessCliInput> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const identityPublicId = (await rl.question("identityPublicId: ")).trim();
    if (identityPublicId.length === 0) {
      throw new Error("identityPublicId é obrigatório.");
    }
    return { identityPublicId };
  } finally {
    rl.close();
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

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const env = loadEnv();
  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER, // usuário runtime — NUNCA migrator
    password: env.DB_PASSWORD
  });
  const service = new BootstrapFirstApplicationAccessService(
    pool,
    (connection) => new MariaDbApplicationRepository(connection),
    (connection) => new MariaDbIdentityRepository(connection),
    (connection) => new MariaDbApplicationAccessRepository(connection),
    (connection) => new MariaDbAuditEventRepository(connection)
  );
  const identityRepository = new MariaDbIdentityRepository(pool);

  runAdminAccessBootstrapCli({
    nodeEnv: env.NODE_ENV,
    // Autorização temporária: lida do ambiente DESTE processo, nunca do
    // .env — ver ADR-027.
    authorization: process.env[PRODUCTION_BOOTSTRAP_AUTHORIZATION_VARIABLE],
    databaseName: env.DB_NAME,
    hostname: hostname(),
    interactive: stdin.isTTY === true,
    collectInput: collectInputInteractive,
    findIdentity: async (identityPublicId) => {
      const publicId = IdentityPublicId.fromString(identityPublicId);
      const identity = await identityRepository.findByPublicId(publicId);
      if (identity === undefined) {
        throw new Error("Identity não encontrada.");
      }
      return {
        publicId: identity.getPublicId().toString(),
        status: identity.getStatus().toString(),
        maskedEmail: maskEmail(identity.getEmail().toString())
      };
    },
    confirm: confirmInteractive,
    service,
    // eslint-disable-next-line no-console
    log: (line) => console.log(line),
    // eslint-disable-next-line no-console
    logError: (line) => console.error(line)
  })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(error instanceof InvalidPublicIdError ? error.message : "Falha fatal inesperada no CLI de concessão administrativa.");
      process.exitCode = 1;
    })
    .finally(() => {
      void pool.end();
    });
}
