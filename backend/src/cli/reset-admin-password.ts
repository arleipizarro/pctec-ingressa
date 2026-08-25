import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbCredentialRepository } from "../modules/security/infrastructure/persistence/MariaDbCredentialRepository.js";
import { MariaDbSessionRepository } from "../modules/security/infrastructure/persistence/MariaDbSessionRepository.js";
import { MariaDbApplicationRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { Argon2PasswordHasher } from "../modules/security/infrastructure/hashing/Argon2PasswordHasher.js";
import { ResetAdminPasswordService } from "../modules/security/application/ResetAdminPasswordService.js";

/**
 * CLI de recuperação administrativa de senha.
 *
 * **A senha entra SÓ por stdin.** Não existe `--password`, e a ausência
 * não é esquecimento: argumento de linha de comando aparece em `ps`, no
 * histórico do shell e em qualquer log de auditoria de comando do host.
 * Variável de ambiente é herdada por processos filhos e vaza em dump de
 * ambiente. Stdin não passa por nenhum dos dois.
 *
 * Uso:
 *   node --env-file=.env dist/cli/reset-admin-password.js \
 *        --identity-public-id=<uuid> --password-stdin
 *
 * A senha é lida do stdin como UMA linha. Entrada vazia é recusada, e
 * conteúdo extra também: duas linhas quase sempre significam que o
 * operador colou senha e confirmação juntas, e adivinhar qual das duas
 * vale seria a pior resposta possível.
 *
 * Saída: 0 concluído | 1 uso inválido | 2 erro de execução
 */

export interface ResetAdminPasswordCliArgs {
  readonly identityPublicId: string;
}

export class ResetAdminPasswordUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ResetAdminPasswordUsageError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv: readonly string[]): ResetAdminPasswordCliArgs {
  // Recusa explícita e ANTES de tudo: se alguém tentar `--password`, o
  // erro precisa dizer por que essa porta não existe, em vez de o
  // argumento ser silenciosamente ignorado.
  if (argv.some((arg) => arg === "--password" || arg.startsWith("--password="))) {
    throw new ResetAdminPasswordUsageError(
      "--password não existe: senha em argumento aparece em `ps`, no histórico do shell e em logs do host. Use --password-stdin."
    );
  }
  if (!argv.includes("--password-stdin")) {
    throw new ResetAdminPasswordUsageError("--password-stdin é obrigatório — a senha só entra por stdin.");
  }

  const bruto = argv.find((arg) => arg.startsWith("--identity-public-id="));
  const identityPublicId = bruto === undefined ? undefined : bruto.slice("--identity-public-id=".length).trim();
  if (identityPublicId === undefined || !UUID.test(identityPublicId)) {
    throw new ResetAdminPasswordUsageError(
      "--identity-public-id=<publicId da Identity administrativa> é obrigatório."
    );
  }

  return { identityPublicId };
}

/**
 * Lê a senha do stdin.
 *
 * Aceita exatamente uma linha não vazia; o `\n` final é descartado. Um
 * stdin vazio (ou só espaços) e qualquer linha extra são recusados —
 * ver docblock do módulo.
 */
export function extrairSenha(bruto: string): string {
  const semQuebraFinal = bruto.replace(/\r?\n$/, "");
  if (semQuebraFinal.includes("\n")) {
    throw new ResetAdminPasswordUsageError(
      "stdin trouxe mais de uma linha — envie apenas a senha, sem confirmação nem conteúdo extra."
    );
  }
  if (semQuebraFinal.trim().length === 0) {
    throw new ResetAdminPasswordUsageError("stdin vazio — nenhuma senha foi recebida.");
  }
  return semQuebraFinal;
}

async function lerStdin(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const pedaco of process.stdin) {
    partes.push(Buffer.from(pedaco));
  }
  return Buffer.concat(partes).toString("utf-8");
}

function log(mensagem: string): void {
  process.stdout.write(`${mensagem}\n`);
}

export async function runResetAdminPasswordCli(
  argv: readonly string[],
  lerEntrada: () => Promise<string> = lerStdin
): Promise<number> {
  const args = parseArgs(argv);
  let senha = extrairSenha(await lerEntrada());
  const env = loadEnv();

  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });

  try {
    log(`[reset] alvo: ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
    log(`[reset] identidade: ${args.identityPublicId}`);

    const service = new ResetAdminPasswordService({
      unitOfWork: new MariaDbUnitOfWork(pool),
      identityRepositoryFactory: (c) => new MariaDbIdentityRepository(c),
      credentialRepositoryFactory: (c) => new MariaDbCredentialRepository(c),
      sessionRepositoryFactory: (c) => new MariaDbSessionRepository(c),
      applicationRepositoryFactory: (c) => new MariaDbApplicationRepository(c),
      applicationAccessRepositoryFactory: (c) => new MariaDbApplicationAccessRepository(c),
      auditEventRepositoryFactory: (c) => new MariaDbAuditEventRepository(c),
      passwordHasher: new Argon2PasswordHasher()
    });

    const resultado = await service.execute({
      identityPublicId: args.identityPublicId,
      plainPassword: senha
    });

    // A senha sai do escopo assim que o serviço termina; nada dela
    // aparece no resultado nem em log.
    senha = "";

    log(`[reset] credencial ${resultado.credentialPublicId} redefinida (versão ${resultado.credentialVersion}).`);
    log(`[reset] sessões revogadas: ${resultado.revokedSessions}.`);
    log("[reset] login_enabled inalterado; nenhuma credencial nova foi criada.");
    return 0;
  } finally {
    senha = "";
    await pool.end();
  }
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runResetAdminPasswordCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const usage = error instanceof ResetAdminPasswordUsageError;
      // A mensagem de erro do domínio nunca contém a senha — os erros
      // desta cadeia carregam status e publicId, nada mais.
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[reset] ${usage ? "uso inválido" : "erro"}: ${message}\n`);
      process.exitCode = usage ? 1 : 2;
    });
}
