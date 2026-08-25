import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbIdentityRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbIdentityExternalReferenceRepository } from "../modules/identity/infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { MariaDbApplicationRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../modules/application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { ActivateFederatedIdentityService } from "../modules/helpdesk/application/ActivateFederatedIdentityService.js";

/**
 * CLI operacional: ativa a Identity de um usuário FEDERADO do Helpdesk.
 *
 * Existe porque `Identity.create` nasce PENDING e, no fluxo nativo,
 * ACTIVE vem do bootstrap de credencial — que nunca vai acontecer para
 * quem autentica no Helpdesk. Sem este comando, a alternativa real
 * seria `UPDATE identities SET status='ACTIVE'`, que resolve o sintoma
 * e apaga a explicação.
 *
 * Todas as recusas vivem no Application Service, não aqui: aprovador
 * ADMIN ACTIVE, vínculo `IdentityExternalReference` ACTIVE de
 * PCTEC_HELPDESK, e `ApplicationAccess` PCTEC_HELPDESK GRANTED.
 * Idempotente: identidade já ACTIVE devolve sucesso sem escrever nada.
 *
 * **Gate triplo de escrita**, mesmo padrão dos demais bootstraps: sem
 * `--execute` roda como simulação (nada é escrito), e `--execute` exige
 * `--approved-by` E `BOOTSTRAP_ALLOW_WRITE=true`. Nenhum dos três
 * sozinho basta.
 *
 * Uso:
 *   node --env-file=<env> dist/cli/activate-federated-identity.js \
 *        --legacy-user-id=<users.id> [--execute --approved-by=<identityPublicId>]
 *
 * Saída: 0 concluído (ou simulado) | 1 uso inválido | 2 erro de execução
 */

export interface ActivateFederatedIdentityCliArgs {
  readonly legacyUserId: number;
  readonly execute: boolean;
  readonly approvedByIdentityPublicId: string | undefined;
}

export class ActivateFederatedIdentityUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ActivateFederatedIdentityUsageError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const comIgual = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (comIgual !== undefined) {
    return comIgual.slice(flag.length + 1).trim();
  }
  const indice = argv.indexOf(flag);
  return indice >= 0 && indice + 1 < argv.length ? String(argv[indice + 1]).trim() : undefined;
}

export function parseArgs(argv: readonly string[]): ActivateFederatedIdentityCliArgs {
  const legacyUserIdRaw = valueOf(argv, "--legacy-user-id");
  if (legacyUserIdRaw === undefined || !/^[1-9][0-9]*$/.test(legacyUserIdRaw)) {
    throw new ActivateFederatedIdentityUsageError(
      "--legacy-user-id=<users.id do Helpdesk> é obrigatório e precisa ser inteiro positivo."
    );
  }

  const execute = argv.includes("--execute");
  const approvedBy = valueOf(argv, "--approved-by");

  if (execute && (approvedBy === undefined || !UUID.test(approvedBy))) {
    throw new ActivateFederatedIdentityUsageError(
      "--execute exige --approved-by=<identityPublicId de um ADMIN ACTIVE>."
    );
  }

  return {
    legacyUserId: Number(legacyUserIdRaw),
    execute,
    approvedByIdentityPublicId: approvedBy
  };
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export async function runActivateFederatedIdentityCli(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const env = loadEnv();

  // Mesma leitura dos demais bootstraps: a variável não está no schema
  // de `env.ts` de propósito — é gate operacional, não configuração da
  // aplicação, e nenhuma rota depende dela.
  const allowWrite = process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true";

  if (args.execute && !allowWrite) {
    throw new ActivateFederatedIdentityUsageError(
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
    log(`[ativacao] alvo: ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
    log(`[ativacao] usuário legado PCTEC_HELPDESK/users/${args.legacyUserId}`);

    if (!args.execute) {
      log("[ativacao] SIMULAÇÃO — nada foi escrito. Use --execute --approved-by=<uuid> com BOOTSTRAP_ALLOW_WRITE=true.");
      return 0;
    }

    const service = new ActivateFederatedIdentityService({
      unitOfWork: new MariaDbUnitOfWork(pool),
      identityRepositoryFactory: (c) => new MariaDbIdentityRepository(c),
      identityExternalReferenceRepositoryFactory: (c) => new MariaDbIdentityExternalReferenceRepository(c),
      applicationRepositoryFactory: (c) => new MariaDbApplicationRepository(c),
      applicationAccessRepositoryFactory: (c) => new MariaDbApplicationAccessRepository(c),
      auditEventRepositoryFactory: (c) => new MariaDbAuditEventRepository(c)
    });

    const resultado = await service.execute({
      legacyUserId: args.legacyUserId,
      approvedByIdentityPublicId: String(args.approvedByIdentityPublicId)
    });

    log(
      resultado.alreadyActive
        ? `[ativacao] identidade ${resultado.identityPublicId} já estava ACTIVE — nada foi escrito.`
        : `[ativacao] identidade ${resultado.identityPublicId} agora está ${resultado.status}.`
    );
    log("[ativacao] nenhuma Credential foi criada — a autenticação continua no Helpdesk.");
    return 0;
  } finally {
    await pool.end();
  }
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runActivateFederatedIdentityCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const usage = error instanceof ActivateFederatedIdentityUsageError;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[ativacao] ${usage ? "uso inválido" : "erro"}: ${message}\n`);
      process.exitCode = usage ? 1 : 2;
    });
}
