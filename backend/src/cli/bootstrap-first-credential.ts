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
import { MariaDbApplicationRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { PublicId as IdentityPublicId, InvalidPublicIdError } from "../modules/identity/domain/value-objects/PublicId.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { MariaDbCredentialRepository } from "../modules/security/infrastructure/persistence/MariaDbCredentialRepository.js";
import { Argon2PasswordHasher } from "../modules/security/infrastructure/hashing/Argon2PasswordHasher.js";
import {
  BootstrapFirstCredentialService,
  type BootstrapFirstCredentialResult
} from "../modules/security/application/BootstrapFirstCredentialService.js";
import {
  CredentialBootstrapAlreadyCompletedError,
  CredentialLockNotAcquiredError
} from "../modules/security/application/errors/CredentialBootstrapErrors.js";
import { IdentityNotFoundForCredentialError } from "../modules/security/domain/errors/CredentialErrors.js";
import { CredentialPasswordPolicyViolationError } from "../modules/security/domain/value-objects/PlainPassword.js";

/**
 * CLI local, one-shot, da primeira Credential — v0.5.x, Fase C,
 * `docs/adr/ADR-029-CREDENTIAL-E-AUTENTICACAO.md`.
 *
 * NUNCA abre socket. NUNCA aceita argumentos de linha de comando (entrada
 * 100% interativa via stdin — mesma razão dos dois CLIs de bootstrap
 * anteriores: elimina por completo "segredo em argv/ps/shell history").
 * A senha é lida em modo oculto (sem eco no terminal) — ver
 * `readHiddenLine` abaixo.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-first-credential.js
 *
 * Exit codes (mesmo esquema dos CLIs de bootstrap anteriores):
 *   0 — credencial criada com sucesso.
 *   1 — cancelado pelo operador, Identity não encontrada, bootstrap já
 *       concluído anteriormente, política de senha violada, ou falha
 *       inesperada.
 *   2 — recusado por NODE_ENV não permitido (produção nesta fatia).
 *   3 — lock não adquirido (outro processo em execução).
 */

export interface CredentialCliInput {
  readonly identityPublicId: string;
  readonly plainPassword: string;
  readonly plainPasswordConfirmation: string;
}

export interface IdentitySummary {
  readonly publicId: string;
  readonly status: string;
  readonly maskedEmail: string;
}

export interface CredentialCliServiceLike {
  execute(request: {
    identityPublicId: string;
    plainPassword: string;
    plainPasswordConfirmation: string;
  }): Promise<BootstrapFirstCredentialResult>;
}

export interface CredentialCliDependencies {
  readonly nodeEnv: string;
  /** `INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP` — só relevante em produção (ADR-027). */
  readonly authorization?: string | undefined;
  /** `DB_NAME` efetivo — entra na frase de confirmação em produção. */
  readonly databaseName?: string;
  readonly hostname?: string;
  /** `true` quando há TTY real. Produção exige. */
  readonly interactive?: boolean;
  readonly collectInput: () => Promise<CredentialCliInput>;
  /** Busca a Identity para exibição prévia — leitura, fora da transação do serviço. Lança se não encontrada. */
  readonly findIdentity: (identityPublicId: string) => Promise<IdentitySummary>;
  readonly confirm: (confirmationPhrase: string) => Promise<string>;
  readonly service: CredentialCliServiceLike;
  readonly log: (line: string) => void;
  readonly logError: (line: string) => void;
}

const CONFIRMATION_PHRASE = "CREATE_CREDENTIAL";

/** Mascara um e-mail — mesma implementação já usada nos CLIs anteriores, nunca ecoa o valor completo. */
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
 * de `bootstrap-first-identity.ts`/`bootstrap-first-admin-access.ts`.
 */
export async function runCredentialBootstrapCli(deps: CredentialCliDependencies): Promise<number> {
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

  let input: CredentialCliInput;
  try {
    input = await deps.collectInput();
  } catch {
    deps.logError("Entrada inválida. Nenhuma alteração foi feita.");
    return 1;
  }

  let identity: IdentitySummary;
  try {
    identity = await deps.findIdentity(input.identityPublicId);
  } catch {
    deps.logError("Identity não encontrada para o publicId informado. Nenhuma alteração foi feita.");
    return 1;
  }

  deps.log("Você está prestes a criar a PRIMEIRA credencial da plataforma.");
  deps.log(`Identity encontrada — publicId: ${identity.publicId}`);
  deps.log(`E-mail: ${identity.maskedEmail}`);
  deps.log(`Status atual da Identity: ${identity.status}`);
  deps.log("Ações desta operação:");
  deps.log("  - criar Credential LOCAL_PASSWORD");
  deps.log("  - ativar a Identity (PENDING → ACTIVE)");
  deps.log("  - habilitar login (loginEnabled → true)");
  deps.log("Esta operação não pode ser desfeita por este CLI.");

  const confirmation = await deps.confirm(ceremony.confirmationPhrase);
  if (normalizeConfirmation(confirmation) !== ceremony.confirmationPhrase) {
    deps.log("Cancelado. Nenhuma conexão de escrita foi aberta, nenhuma credencial foi criada.");
    return 1;
  }

  try {
    const result = await deps.service.execute({
      identityPublicId: input.identityPublicId,
      plainPassword: input.plainPassword,
      plainPasswordConfirmation: input.plainPasswordConfirmation
    });

    deps.log("Credential criada.");
    deps.log(`identityPublicId: ${result.identityPublicId}`);
    deps.log(`credentialType: ${result.credentialType}`);
    deps.log(`identityStatus: ${result.identityStatus}`);
    deps.log(`loginEnabled: ${result.loginEnabled}`);
    return 0;
  } catch (error) {
    if (error instanceof CredentialBootstrapAlreadyCompletedError) {
      deps.logError("O bootstrap da primeira credencial já foi realizado anteriormente.");
      return 1;
    }
    if (error instanceof CredentialLockNotAcquiredError) {
      deps.logError("Não foi possível adquirir o lock — outro processo parece estar em execução.");
      return 3;
    }
    if (error instanceof CredentialPasswordPolicyViolationError) {
      deps.logError("Senha não cumpre a política mínima. Nenhuma alteração foi confirmada.");
      return 1;
    }
    if (error instanceof IdentityNotFoundForCredentialError) {
      deps.logError("Identity não encontrada no momento da criação. Nenhuma alteração foi confirmada.");
      return 1;
    }
    // Qualquer outro erro (bug, driver, etc.) — nunca vaza SQL, stack,
    // senha ou valor de configuração na saída do CLI.
    deps.logError("Falha inesperada durante a criação da credencial. Nenhuma alteração foi confirmada.");
    return 1;
  }
}

// ---------------------------------------------------------------------
// I/O real (não testado diretamente — a lógica acima é o que é testado)
// ---------------------------------------------------------------------

async function collectIdentityPublicId(): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const value = (await rl.question("identityPublicId: ")).trim();
    if (value.length === 0) {
      throw new Error("identityPublicId é obrigatório.");
    }
    return value;
  } finally {
    rl.close();
  }
}

export interface HiddenLineInputStream {
  readonly isTTY: boolean | undefined;
  setRawMode(mode: boolean): void;
  resume(): void;
  pause(): void;
  on(event: "data", listener: (chunk: Buffer) => void): void;
  once(event: "end" | "error", listener: (...args: never[]) => void): void;
  removeListener(event: string, listener: (...args: never[]) => void): void;
}

export interface HiddenLineOutputStream {
  write(text: string): void;
}

export interface HiddenLineProcessSignals {
  once(event: "SIGINT", listener: () => void): void;
  removeListener(event: string, listener: () => void): void;
}

/**
 * Núcleo testável de `readHiddenLine` — separado de `node:process` real
 * (mesma filosofia de `runCredentialBootstrapCli`/dependências
 * injetadas) para permitir provar o hardening (raw mode sempre
 * restaurado, EOF, erro de stream, SIGINT) sem depender de um TTY real,
 * que não existe neste ambiente de build/CI.
 *
 * Implementado com Node.js puro (modo raw do TTY via
 * `input.setRawMode`), sem dependência externa — avaliado explicitamente
 * (task, seção 19): a técnica é padrão e bem estabelecida, não uma
 * gambiarra insegura, desde que o modo raw seja sempre restaurado (ver
 * `cleanup`, chamado de TODOS os caminhos de saída) e `Ctrl+C`/`SIGINT`
 * sejam tratados explicitamente.
 *
 * **Hardening (revisão crítica antes do commit):** `cleanup()` é
 * chamado, de forma idempotente (guardada por `settled`), em TODOS os
 * caminhos de saída possíveis:
 *
 * - sucesso (Enter/Ctrl+D);
 * - cancelamento (Ctrl+C recebido como byte de dado, modo raw);
 * - `SIGINT` genuíno de nível de processo (ex.: `kill -SIGINT`, não
 *   apenas a tecla Ctrl+C local) — sem isso, um sinal externo durante a
 *   leitura poderia encerrar o processo com o terminal ainda em modo
 *   raw, quebrando o shell do operador após o processo morrer;
 * - erro inesperado dentro do processamento de um chunk de dado
 *   (`try/catch` em `onData` — nunca deixa uma exceção não tratada
 *   pendurar o listener nem o modo raw);
 * - `stdin` encerrado inesperadamente (evento `end` — EOF real do
 *   stream, distinto de Ctrl+D como tecla);
 * - erro no próprio stream `stdin` (evento `error`).
 */
export async function readHiddenLineFrom(
  promptText: string,
  input: HiddenLineInputStream,
  output: HiddenLineOutputStream,
  processSignals: HiddenLineProcessSignals
): Promise<string> {
  if (!input.isTTY) {
    throw new Error("Entrada oculta exige um terminal interativo (TTY).");
  }

  output.write(promptText);

  return new Promise<string>((resolve, reject) => {
    let value = "";
    let settled = false;

    const cleanup = (): void => {
      input.removeListener("data", onData);
      input.removeListener("end", onStreamEnd);
      input.removeListener("error", onStreamError);
      processSignals.removeListener("SIGINT", onProcessSigint);
      if (input.isTTY) {
        input.setRawMode(false);
      }
      input.pause();
    };

    const settleResolve = (result: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const settleReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      try {
        const char = chunk.toString("utf8");
        switch (char) {
          case "\n":
          case "\r":
          case "\u0004": // Ctrl+D
            output.write("\n");
            settleResolve(value);
            break;
          case "\u0003": // Ctrl+C recebido como byte de dado (modo raw desativa o SIGINT automático do terminal para esta tecla).
            output.write("\n");
            settleReject(new Error("Entrada cancelada pelo operador (Ctrl+C)."));
            break;
          case "\u007f": // Backspace
          case "\b":
            value = value.slice(0, -1);
            break;
          default:
            // Aceita apenas caracteres imprimíveis — ignora outras sequências de controle.
            if (char.length > 0 && char >= " ") {
              value += char;
            }
            break;
        }
      } catch (error) {
        // Nunca deixa uma exceção inesperada aqui pendurar o listener
        // nem o modo raw do terminal.
        settleReject(error instanceof Error ? error : new Error("Falha inesperada ao processar entrada oculta."));
      }
    };

    const onStreamEnd = (): void => {
      settleReject(new Error("Entrada encerrada inesperadamente (EOF) antes de concluir a leitura."));
    };

    const onStreamError = (error: Error): void => {
      settleReject(error);
    };

    /**
     * SIGINT genuíno de nível de processo — distinto do byte `\u0003`
     * capturado em `onData` (que só acontece via teclado local, em modo
     * raw). Registrado SOMENTE durante a janela desta leitura
     * (removido em `cleanup()`) — fora dela, o comportamento padrão do
     * Node para SIGINT permanece intacto.
     */
    const onProcessSigint = (): void => {
      output.write("\n");
      settleReject(new Error("Entrada cancelada pelo operador (SIGINT)."));
    };

    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    input.once("end", onStreamEnd);
    input.once("error", onStreamError);
    processSignals.once("SIGINT", onProcessSigint);
  });
}

/** Wrapper de produção — usa `process.stdin`/`process.stdout`/`process` reais. */
export async function readHiddenLine(promptText: string): Promise<string> {
  return readHiddenLineFrom(promptText, stdin, stdout, process);
}

async function collectInputInteractive(): Promise<CredentialCliInput> {
  const identityPublicId = await collectIdentityPublicId();
  const plainPassword = await readHiddenLine("Senha (não será exibida): ");
  const plainPasswordConfirmation = await readHiddenLine("Confirme a senha (não será exibida): ");
  return { identityPublicId, plainPassword, plainPasswordConfirmation };
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
  const service = new BootstrapFirstCredentialService(
    pool,
    (connection) => new MariaDbCredentialRepository(connection),
    (connection) => new MariaDbIdentityRepository(connection),
    (connection) => new MariaDbAuditEventRepository(connection),
    new Argon2PasswordHasher(),
    (connection) => new MariaDbApplicationRepository(connection),
    (connection) => new MariaDbApplicationAccessRepository(connection)
  );
  const identityRepository = new MariaDbIdentityRepository(pool);

  runCredentialBootstrapCli({
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
      console.error(error instanceof InvalidPublicIdError ? error.message : "Falha fatal inesperada no CLI de bootstrap de credencial.");
      process.exitCode = 1;
    })
    .finally(() => {
      void pool.end();
    });
}
