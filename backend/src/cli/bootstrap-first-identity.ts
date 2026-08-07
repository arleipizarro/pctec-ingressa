import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import {
  BootstrapFirstIdentityService,
  type BootstrapFirstIdentityResult
} from "../modules/identity/application/BootstrapFirstIdentityService.js";
import {
  BootstrapAlreadyCompletedError,
  BootstrapLockNotAcquiredError
} from "../modules/identity/application/errors/BootstrapErrors.js";

/**
 * CLI local, one-shot, do bootstrap da primeira Identity fundacional —
 * v0.5.0, `docs/adr/ADR-027-BOOTSTRAP-ADMINISTRATIVO-INICIAL.md`.
 *
 * NUNCA abre socket. NUNCA depende de PM2/Nginx. NUNCA aceita argumentos
 * de linha de comando (entrada é 100% interativa via stdin — elimina por
 * completo a classe de risco "segredo em argv/ps/shell history"). Usa as
 * credenciais runtime (`DB_USER` de `loadEnv()`), nunca migrator.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-first-identity.js
 *
 * Exit codes:
 *   0 — bootstrap concluído com sucesso.
 *   1 — cancelado pelo operador, entrada inválida, bootstrap já
 *       concluído anteriormente, ou falha inesperada.
 *   2 — recusado por NODE_ENV não permitido (produção nesta fatia).
 *   3 — lock não adquirido (outro processo de bootstrap em execução).
 */

export interface BootstrapCliInput {
  readonly fullName: string;
  readonly email: string;
  readonly cpf?: string | undefined;
}

export interface BootstrapCliServiceLike {
  execute(request: { fullName: string; email: string; cpf?: string | undefined }): Promise<BootstrapFirstIdentityResult>;
}

export interface BootstrapCliDependencies {
  readonly nodeEnv: string;
  readonly collectInput: () => Promise<BootstrapCliInput>;
  readonly confirm: () => Promise<string>;
  readonly service: BootstrapCliServiceLike;
  readonly log: (line: string) => void;
  readonly logError: (line: string) => void;
}

/** Ambientes explicitamente permitidos nesta fatia — produção fica de fora até decisão formal futura (ADR-027, seção "Controles de segurança"). */
const ALLOWED_NODE_ENVS = new Set(["development", "test"]);

const CONFIRMATION_PHRASE = "BOOTSTRAP";

/** Mascara um CPF, mostrando só os 2 últimos dígitos — nunca o valor completo. */
export function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length < 2) {
    return "**";
  }
  return `***.***.**${digits.slice(-2)}`;
}

/**
 * Mascara um e-mail, mostrando só o primeiro caractere da parte local e
 * o domínio completo — nunca o e-mail completo fornecido. Determinístico
 * (mesmo e-mail sempre produz a mesma máscara), nunca altera o valor
 * persistido (a máscara é só para exibição no terminal).
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) {
    return "***"; // formato inesperado — nunca ecoa o valor bruto mesmo assim.
  }
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  return `${localPart.charAt(0)}***@${domain}`;
}

/**
 * Lógica de decisão do CLI, separada de I/O real (stdin/readline/console)
 * — testável diretamente com dependências fake, sem terminal real e sem
 * banco real. Mesma filosofia já usada em `migrate.ts`
 * (`executeMigrateCommand`).
 */
export async function runBootstrapCli(deps: BootstrapCliDependencies): Promise<number> {
  if (!ALLOWED_NODE_ENVS.has(deps.nodeEnv)) {
    deps.logError(
      `Bootstrap recusado: NODE_ENV="${deps.nodeEnv}" não é permitido nesta fatia. ` +
        `Apenas "development"/"test". Produção exige um processo formalmente aprovado no futuro (ver ADR-027).`
    );
    return 2;
  }

  let input: BootstrapCliInput;
  try {
    input = await deps.collectInput();
  } catch {
    deps.logError("Entrada inválida — fullName e email são obrigatórios. Nenhuma alteração foi feita.");
    return 1;
  }

  deps.log("Você está prestes a criar a PRIMEIRA Identity fundacional da plataforma.");
  deps.log(`Nome: ${input.fullName}`);
  deps.log(`E-mail: ${maskEmail(input.email)}`);
  if (input.cpf !== undefined && input.cpf.length > 0) {
    deps.log(`CPF: ${maskCpf(input.cpf)}`);
  }
  deps.log("Isto NÃO cria um administrador funcional (ver ADR-027) — só a Identity fundacional.");
  deps.log("Esta operação não pode ser desfeita por este CLI.");

  const confirmation = await deps.confirm();
  if (confirmation.trim() !== CONFIRMATION_PHRASE) {
    deps.log("Cancelado. Nenhuma conexão de escrita foi aberta, nenhuma Identity foi criada.");
    return 1;
  }

  try {
    const result = await deps.service.execute({
      fullName: input.fullName,
      email: input.email,
      cpf: input.cpf
    });

    deps.log("Bootstrap concluído.");
    deps.log(`publicId: ${result.publicId}`);
    deps.log(`email: ${maskEmail(input.email)}`);
    deps.log(`status: ${result.status}`);
    deps.log(`loginEnabled: ${result.loginEnabled}`);
    deps.log("Nenhuma Credential foi criada. Nenhum acesso administrativo foi concedido (ver ADR-027, Fases B/C/D).");
    return 0;
  } catch (error) {
    if (error instanceof BootstrapAlreadyCompletedError) {
      deps.logError("Bootstrap já foi concluído anteriormente — já existe ao menos uma Identity no diretório.");
      return 1;
    }
    if (error instanceof BootstrapLockNotAcquiredError) {
      deps.logError("Não foi possível adquirir o lock de bootstrap — outro processo parece estar em execução.");
      return 3;
    }
    // Qualquer outro erro (bug, driver, etc.) — nunca vaza SQL, stack ou
    // valor de configuração na saída do CLI.
    deps.logError("Falha inesperada durante o bootstrap. Nenhuma alteração foi confirmada.");
    return 1;
  }
}

async function collectInputInteractive(): Promise<BootstrapCliInput> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const fullName = (await rl.question("Nome completo: ")).trim();
    const email = (await rl.question("E-mail: ")).trim();
    const cpfRaw = (await rl.question("CPF (opcional — Enter para pular): ")).trim();

    if (fullName.length === 0 || email.length === 0) {
      throw new Error("fullName e email são obrigatórios.");
    }

    return { fullName, email, cpf: cpfRaw.length > 0 ? cpfRaw : undefined };
  } finally {
    rl.close();
  }
}

async function confirmInteractive(): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(`Digite ${CONFIRMATION_PHRASE} para confirmar (qualquer outra coisa cancela): `);
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
  const service = new BootstrapFirstIdentityService(
    pool,
    (connection) => new MariaDbIdentityRepository(connection),
    (connection) => new MariaDbAuditEventRepository(connection)
  );

  runBootstrapCli({
    nodeEnv: env.NODE_ENV,
    collectInput: collectInputInteractive,
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
      console.error(error instanceof Error ? "Falha fatal inesperada no CLI de bootstrap." : String(error));
      process.exitCode = 1;
    })
    .finally(() => {
      void pool.end();
    });
}
