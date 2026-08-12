import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbOrganizationRepository } from "../modules/organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbAuditEventRepository } from "../modules/audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateOrganizationService } from "../modules/organization/application/CreateOrganizationService.js";

/**
 * Micro-CLI administrativa — gap operacional encontrado na homologação
 * de G4: não havia forma de criar uma `Organization` isolada, real,
 * usando o domínio, sem recorrer a `bootstrap-organizations-from-legacy.ts`
 * (feito para lotes de registros legados, com `systemCode`/`legacyId`
 * que não fazem sentido para uma criação administrativa avulsa) ou a
 * SQL manual (nunca aceitável — nenhuma query/insert fora de
 * repository/service já existente).
 *
 * Reaproveita `CreateOrganizationService` (G1) sem nenhuma alteração —
 * mesma disciplina das demais CLIs de bootstrap: nenhuma lógica de
 * domínio nova, só orquestração de CLI.
 *
 * **PREPARADO nesta entrega, NÃO EXECUTADO.** Nenhum chamado real a
 * este CLI foi feito nesta rodada — só typecheck/build.
 *
 * **`--actor` — revisão pré-commit: NUNCA um default silencioso para
 * escrita real.** `"SYSTEM"` não é um Actor canônico formalmente
 * aceito pelo domínio de `Organization` (auditoria confirmou: o VO
 * `ActorPublicId` que reconhece `SYSTEM` existe só no módulo
 * `identity`, nunca reaproveitado aqui; `Organization.create()` recebe
 * `actorPublicId` como `string` crua, sem validação de conjunto
 * fechado; a única ocorrência prévia de `"SYSTEM"` como actor de
 * Organization era convenção de `bootstrap-organizations-from-legacy.ts`,
 * nunca testada além do parsing de argv, nunca exercida contra o
 * domínio de verdade). Por isso:
 * - em **dry-run**, `--actor` pode ser omitido (nada é escrito, não há
 *   o que auditar);
 * - em **`--execute`**, `--actor <identityPublicId>` é OBRIGATÓRIO —
 *   a criação real fica auditada contra uma Identity administrativa
 *   real, nunca um marcador textual.
 *
 * **Nunca hardcode Identity/Organization** — `actor`, quando exigido, é
 * sempre um argumento explícito, nunca valor fixo no código.
 *
 * Uso (depois de `npm run build`):
 *   node dist/cli/bootstrap-organization.js <type> <legalName> [--trade-name <nome>] [--document-number <cnpj>] [--execute --actor <identityPublicId>]
 *
 * Mesmo gate duplo das demais CLIs de bootstrap: escrita real exige
 * `--execute` E `BOOTSTRAP_ALLOW_WRITE=true` E `--actor` simultaneamente;
 * `NODE_ENV=production` recusa sempre.
 */

export interface CliArgs {
  readonly type: string;
  readonly legalName: string;
  readonly tradeName: string | undefined;
  readonly documentNumber: string | undefined;
  readonly execute: boolean;
  /** `undefined` é válido em dry-run — só é exigido quando `execute=true` (ver `evaluateOrganizationWriteGate`). */
  readonly actorPublicId: string | undefined;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const [type, legalName, ...rest] = argv;
  if (type === undefined || legalName === undefined) {
    throw new Error(
      "Uso: bootstrap-organization.js <type> <legalName> [--trade-name <nome>] [--document-number <cnpj>] [--execute --actor <identityPublicId>]"
    );
  }

  const tradeNameIndex = rest.indexOf("--trade-name");
  const tradeName = tradeNameIndex >= 0 ? rest[tradeNameIndex + 1] : undefined;
  if (tradeNameIndex >= 0 && tradeName === undefined) {
    throw new Error("--trade-name exige um valor em seguida.");
  }

  const documentNumberIndex = rest.indexOf("--document-number");
  const documentNumber = documentNumberIndex >= 0 ? rest[documentNumberIndex + 1] : undefined;
  if (documentNumberIndex >= 0 && documentNumber === undefined) {
    throw new Error("--document-number exige um valor em seguida.");
  }

  const actorIndex = rest.indexOf("--actor");
  const actorPublicId = actorIndex >= 0 ? rest[actorIndex + 1] : undefined;
  if (actorIndex >= 0 && actorPublicId === undefined) {
    throw new Error("--actor exige um publicId em seguida.");
  }

  return {
    type,
    legalName,
    tradeName,
    documentNumber,
    execute: rest.includes("--execute"),
    // NUNCA default para "SYSTEM" — omitido é omitido; a exigência (só
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

/**
 * Mesmo princípio das demais CLIs de bootstrap (G2/G3/G3.1), com UMA
 * checagem a mais: `--actor` é obrigatório sempre que `execute=true`
 * (revisão pré-commit desta CLI — nunca default silencioso para uma
 * mutação real do Cadastro Mestre). Em caso de sucesso, retorna também
 * `actorPublicId` já estreitado para `string` (nunca `undefined`) —
 * evita o chamador precisar reafirmar essa garantia com uma asserção
 * não-nula solta.
 */
export function evaluateOrganizationWriteGate(args: CliArgs, gateEnv: DestructiveGateEnv): DestructiveGateDecision {
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
  const gateDecision = evaluateOrganizationWriteGate(args, {
    nodeEnv: process.env["NODE_ENV"] ?? "",
    allowWriteEnvVar: process.env["BOOTSTRAP_ALLOW_WRITE"]?.toLowerCase() === "true"
  });

  if (!gateDecision.allowed) {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-organization] Recusado (motivo: ${gateDecision.reason}). Nada foi escrito.`);
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

    const createOrganizationService = new CreateOrganizationService(
      unitOfWork,
      (connection) => new MariaDbOrganizationRepository(connection),
      (connection) => new MariaDbAuditEventRepository(connection)
    );
    const result = await createOrganizationService.execute({
      type: args.type,
      legalName: args.legalName,
      tradeName: args.tradeName,
      documentNumber: args.documentNumber,
      actorPublicId: gateDecision.actorPublicId
    });
    // eslint-disable-next-line no-console
    console.log(`[bootstrap-organization] Organization criada: ${result.publicId} (${result.type}, ${result.status})`);
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[bootstrap-organization] ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
