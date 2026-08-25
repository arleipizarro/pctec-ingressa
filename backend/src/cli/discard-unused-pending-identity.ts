import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbIdentityUsageCounters } from "../modules/identity/infrastructure/persistence/MariaDbIdentityUsageCounters.js";
import { MariaDbApplicationRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { DiscardUnusedPendingIdentityService } from "../modules/identity/application/DiscardUnusedPendingIdentityService.js";

/**
 * CLI de descarte de Identity PENDING nunca usada.
 *
 * Alvo é sempre UM `publicId` explícito — não existe `--all`, `--name`
 * nem `--email`. Um filtro por nome transformaria um cadastro real
 * parecido em exclusão silenciosa, e este comando apaga fisicamente.
 *
 * Gate triplo, igual aos demais comandos destrutivos: sem `--execute`
 * roda como simulação; `--execute` exige `--approved-by` E
 * `BOOTSTRAP_ALLOW_WRITE=true`.
 *
 * Uso:
 *   node --env-file=.env dist/cli/discard-unused-pending-identity.js \
 *        --identity-public-id=<uuid> [--execute --approved-by=<uuid>]
 *
 * Saída: 0 concluído/simulado | 1 uso inválido | 2 erro de execução
 */

export interface DiscardCliArgs {
  readonly identityPublicId: string;
  readonly execute: boolean;
  readonly approvedByIdentityPublicId: string | undefined;
}

export class DiscardCliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DiscardCliUsageError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function valorDe(argv: readonly string[], flag: string): string | undefined {
  const comIgual = argv.find((arg) => arg.startsWith(`${flag}=`));
  return comIgual === undefined ? undefined : comIgual.slice(flag.length + 1).trim();
}

export function parseArgs(argv: readonly string[]): DiscardCliArgs {
  for (const proibido of ["--all", "--name", "--email", "--like", "--status"]) {
    if (argv.some((arg) => arg === proibido || arg.startsWith(`${proibido}=`))) {
      throw new DiscardCliUsageError(
        `${proibido} não existe: o descarte é físico e o alvo é sempre um publicId explícito.`
      );
    }
  }

  const identityPublicId = valorDe(argv, "--identity-public-id");
  if (identityPublicId === undefined || !UUID.test(identityPublicId)) {
    throw new DiscardCliUsageError("--identity-public-id=<publicId> é obrigatório.");
  }

  const execute = argv.includes("--execute");
  const approvedBy = valorDe(argv, "--approved-by");
  if (execute && (approvedBy === undefined || !UUID.test(approvedBy))) {
    throw new DiscardCliUsageError("--execute exige --approved-by=<publicId de um ADMIN ACTIVE>.");
  }

  return { identityPublicId, execute, approvedByIdentityPublicId: approvedBy };
}

function log(mensagem: string): void {
  process.stdout.write(`${mensagem}\n`);
}

export async function runDiscardCli(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const env = loadEnv();
  const allowWrite = process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true";

  if (args.execute && !allowWrite) {
    throw new DiscardCliUsageError(
      "--execute exige BOOTSTRAP_ALLOW_WRITE=true no ambiente — gate triplo, nunca um só."
    );
  }

  const pool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });

  try {
    log(`[descarte] alvo: ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
    log(`[descarte] identidade: ${args.identityPublicId}`);

    const contadores = new MariaDbIdentityUsageCounters(pool);
    const [credenciais, referencias, memberships, acessos, sessoes] = await Promise.all([
      contadores.countCredentials(args.identityPublicId),
      contadores.countExternalReferences(args.identityPublicId),
      contadores.countMemberships(args.identityPublicId),
      contadores.countApplicationAccesses(args.identityPublicId),
      contadores.countSessions(args.identityPublicId)
    ]);
    log(
      `[descarte] vínculos: credenciais=${credenciais} referências=${referencias} ` +
        `memberships=${memberships} acessos=${acessos} sessões=${sessoes}`
    );

    if (!args.execute) {
      log("[descarte] SIMULAÇÃO — nada foi removido. Use --execute --approved-by=<uuid> com BOOTSTRAP_ALLOW_WRITE=true.");
      return 0;
    }

    const service = new DiscardUnusedPendingIdentityService({
      unitOfWork: new MariaDbUnitOfWork(pool),
      identityRepositoryFactory: (c) => new MariaDbIdentityRepository(c),
      usageCountersFactory: (c) => new MariaDbIdentityUsageCounters(c),
      applicationRepositoryFactory: (c) => new MariaDbApplicationRepository(c),
      applicationAccessRepositoryFactory: (c) => new MariaDbApplicationAccessRepository(c),
      auditEventRepositoryFactory: (c) => new MariaDbAuditEventRepository(c)
    });

    const resultado = await service.execute({
      identityPublicId: args.identityPublicId,
      approvedByIdentityPublicId: String(args.approvedByIdentityPublicId)
    });

    log(
      resultado.alreadyAbsent
        ? "[descarte] identidade já não existia — nada foi removido."
        : "[descarte] identidade descartada; evento identity.discarded registrado."
    );
    return 0;
  } finally {
    await pool.end();
  }
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runDiscardCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const usage = error instanceof DiscardCliUsageError;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[descarte] ${usage ? "uso inválido" : "erro"}: ${message}\n`);
      process.exitCode = usage ? 1 : 2;
    });
}
