import { fileURLToPath } from "node:url";
import { loadEnv } from "../app/config/env.js";
import { createPool } from "../shared/database/Pool.js";
import { MariaDbUnitOfWork } from "../shared/database/UnitOfWork.js";
import { MariaDbImportBatchRepository } from "../modules/import/infrastructure/persistence/MariaDbImportBatchRepository.js";
import { MariaDbImportBatchItemRepository } from "../modules/import/infrastructure/persistence/MariaDbImportBatchItemRepository.js";
import { MariaDbIngressaTargetStateReader } from "../modules/import/infrastructure/persistence/MariaDbIngressaTargetStateReader.js";
import { MariaDbPilotApplyWriter } from "../modules/import/infrastructure/persistence/MariaDbPilotApplyWriter.js";
import { MariaDbHelpdeskReadOnlySource } from "../modules/import/infrastructure/source/MariaDbHelpdeskReadOnlySource.js";
import { loadHelpdeskSourceConfig } from "../modules/import/infrastructure/source/HelpdeskSourceConfig.js";
import { StartImportBatchService } from "../modules/import/application/StartImportBatchService.js";
import { RecordImportBatchItemService } from "../modules/import/application/RecordImportBatchItemService.js";
import { FinishImportBatchService } from "../modules/import/application/FinishImportBatchService.js";
import {
  RunHelpdeskPilotImportService,
  type RunPilotImportResult
} from "../modules/import/application/RunHelpdeskPilotImportService.js";
import {
  NEGATIVE_CONTROL_USER_ID,
  PILOT_MAPPING_RULES_VERSION,
  PILOT_USER_IDS
} from "../modules/import/domain/pilot/HelpdeskPilotScope.js";

/**
 * CLI operacional do piloto Helpdesk → Ingressa (v0.8.x).
 *
 * Escopo fechado nos usuários ${PILOT_USER_IDS}: não existe `--all`,
 * não existe `--ids`, não existe `--client`, não existe expansão por
 * grupo. Ampliar o piloto é mudança de código com PR, não uma flag que
 * alguém digita às 23h.
 *
 * DRY_RUN é o padrão e não precisa ser pedido. APPLY precisa de duas
 * coisas explícitas — o lote de dry-run aprovado e quem aprovou — e
 * ainda assim passa por todos os gates de `ImportBatch.startApply`.
 *
 * Uso:
 *   node --env-file=.env \
 *        --env-file=/app/.config/pctec-ingressa/helpdesk-source.env \
 *        dist/cli/helpdesk-import-pilot.js --dry-run \
 *        --expected-source-client-id=<clients.id> \
 *        --target-organization-public-id=<publicId>
 *
 *   node --env-file=... dist/cli/helpdesk-import-pilot.js --apply \
 *        --expected-source-client-id=<clients.id> \
 *        --target-organization-public-id=<publicId> \
 *        --dry-run-batch=<uuid> --approved-by=<identityPublicId>
 *
 * Saída:
 *   0 — execução concluída
 *   1 — recusa de uso (argumentos inválidos)
 *   2 — erro de execução
 */

export interface PilotCliArgs {
  readonly mode: "DRY_RUN" | "APPLY";
  readonly expectedSourceClientId: number;
  readonly targetOrganizationPublicId: string;
  readonly dryRunBatchPublicId: string | undefined;
  readonly approvedByIdentityPublicId: string | undefined;
}

export class PilotCliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PilotCliUsageError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `--apply` sozinho é recusado de propósito.
 *
 * Sem `--dry-run-batch`, "aplicar" seria uma operação sem simulação
 * revisada — e é justamente a revisão que autoriza a escrita. O domínio
 * também recusaria (`ApplyWithoutDryRunError`), mas recusar aqui evita
 * abrir conexão e lote para morrer adiante.
 */
export function parseArgs(argv: readonly string[]): PilotCliArgs {
  const apply = argv.includes("--apply");
  const dryRun = argv.includes("--dry-run");

  if (apply && dryRun) {
    throw new PilotCliUsageError("--dry-run e --apply são mutuamente exclusivos.");
  }
  for (const proibido of ["--all", "--ids", "--client", "--group", "--client-group"]) {
    if (argv.some((arg) => arg === proibido || arg.startsWith(`${proibido}=`))) {
      throw new PilotCliUsageError(
        `${proibido} não existe: o escopo desta fatia é fixo (${PILOT_USER_IDS.join(", ")}).`
      );
    }
  }

  // O mapeamento é obrigatório nos DOIS modos. Não há default: o
  // `clients.id` da origem e o `publicId` da Organization de destino são
  // afirmação de quem opera, verificada contra o banco antes do lote.
  // Um default aqui seria hardcode com outro nome.
  const expectedSourceClientId = requireClientId(valueOf(argv, "--expected-source-client-id"));
  const targetOrganizationPublicId = requireUuid(
    valueOf(argv, "--target-organization-public-id"),
    "--target-organization-public-id=<publicId da Organization de destino>"
  );

  if (!apply) {
    return {
      mode: "DRY_RUN",
      expectedSourceClientId,
      targetOrganizationPublicId,
      dryRunBatchPublicId: undefined,
      approvedByIdentityPublicId: undefined
    };
  }

  const batch = valueOf(argv, "--dry-run-batch");
  const approvedBy = valueOf(argv, "--approved-by");

  if (batch === undefined || !UUID.test(batch)) {
    throw new PilotCliUsageError("--apply exige --dry-run-batch=<publicId do lote de dry-run aprovado>.");
  }
  if (approvedBy === undefined || !UUID.test(approvedBy)) {
    throw new PilotCliUsageError("--apply exige --approved-by=<identityPublicId de quem aprovou>.");
  }

  return {
    mode: "APPLY",
    expectedSourceClientId,
    targetOrganizationPublicId,
    dryRunBatchPublicId: batch,
    approvedByIdentityPublicId: approvedBy
  };
}

function requireClientId(raw: string | undefined): number {
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) {
    throw new PilotCliUsageError(
      "--expected-source-client-id=<clients.id do Helpdesk> é obrigatório e precisa ser um inteiro positivo."
    );
  }
  return Number(raw);
}

function requireUuid(raw: string | undefined, ajuda: string): string {
  if (raw === undefined || !UUID.test(raw)) {
    throw new PilotCliUsageError(`${ajuda} é obrigatório e precisa ser um publicId.`);
  }
  return raw;
}

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const comIgual = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (comIgual !== undefined) {
    return comIgual.slice(flag.length + 1).trim();
  }
  const indice = argv.indexOf(flag);
  if (indice >= 0 && indice + 1 < argv.length) {
    return String(argv[indice + 1]).trim();
  }
  return undefined;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function formatReport(resultado: RunPilotImportResult): string {
  const linhas: string[] = [];
  linhas.push(`[piloto] lote ............ ${resultado.batchPublicId}`);
  linhas.push(`[piloto] modo ............ ${resultado.mode} (${resultado.status})`);
  linhas.push(`[piloto] regras .......... ${resultado.mappingRulesVersion}`);
  linhas.push(`[piloto] organização ..... ${resultado.organizationLegalName} (${resultado.organizationPublicId})`);
  linhas.push(
    `[piloto] mapeamento ...... clients:${resultado.expectedSourceClientId} ` +
      `"${resultado.sourceClientName}" -> ${resultado.organizationPublicId}`
  );
  linhas.push(`[piloto] snapshotFP ...... ${resultado.snapshotFingerprint}`);
  linhas.push(`[piloto] scopeFP ......... ${resultado.scopeFingerprint}`);
  linhas.push(`[piloto] counts_before ... ${JSON.stringify(resultado.countsBefore)}`);
  linhas.push(`[piloto] counts_after .... ${JSON.stringify(resultado.countsAfter)}`);
  linhas.push(`[piloto] ações ........... ${JSON.stringify(resultado.countsByAction)}`);
  for (const usuario of resultado.users) {
    linhas.push(
      `[piloto]   users:${usuario.sourceLegacyId} ${JSON.stringify(usuario.actionsByEntityKind)} ` +
        `motivos=${usuario.reasonCodes.join(",")}`
    );
  }
  linhas.push(`[piloto] itens gravados .. ${resultado.recordedItems}`);
  if (resultado.resumedUsers.length > 0) {
    linhas.push(`[piloto] retomados ....... users ${resultado.resumedUsers.join(", ")} (já concluídos neste lote)`);
  }
  linhas.push(`[piloto] controle negativo users:${NEGATIVE_CONTROL_USER_ID} — ausente do lote por construção.`);
  return linhas.join("\n");
}

export async function runPilotCli(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const env = loadEnv();
  const sourceConfig = loadHelpdeskSourceConfig();

  const ingressaPool = createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });
  const helpdeskPool = createPool(sourceConfig);

  try {
    const unitOfWork = new MariaDbUnitOfWork(ingressaPool);
    const runner = new RunHelpdeskPilotImportService({
      source: new MariaDbHelpdeskReadOnlySource(helpdeskPool),
      targetStateReader: new MariaDbIngressaTargetStateReader(ingressaPool),
      startImportBatchService: new StartImportBatchService(
        unitOfWork,
        (connection) => new MariaDbImportBatchRepository(connection)
      ),
      recordImportBatchItemService: new RecordImportBatchItemService(
        unitOfWork,
        (connection) => new MariaDbImportBatchRepository(connection),
        (connection) => new MariaDbImportBatchItemRepository(connection)
      ),
      finishImportBatchService: new FinishImportBatchService(
        unitOfWork,
        (connection) => new MariaDbImportBatchRepository(connection)
      ),
      applyWriter: args.mode === "APPLY" ? new MariaDbPilotApplyWriter(unitOfWork) : undefined,
      countsReader:
        args.mode === "APPLY"
          ? async () => {
              const estado = await new MariaDbIngressaTargetStateReader(ingressaPool).read({
                targetOrganizationPublicId: args.targetOrganizationPublicId,
                applicationCode: "PCTEC_HELPDESK",
                sourceLegacyIds: [],
                emailsNormalized: []
              });
              return estado.counts;
            }
          : undefined,
      batchActionCounter: async (batchPublicId) =>
        new MariaDbImportBatchItemRepository(ingressaPool).countByAction(batchPublicId),
      processedSourceKeysReader: async (batchPublicId) =>
        new MariaDbImportBatchItemRepository(ingressaPool).findProcessedSourceKeys(batchPublicId)
    });

    log(`[piloto] escopo fixo: users ${PILOT_USER_IDS.join(", ")} — regras ${PILOT_MAPPING_RULES_VERSION}`);
    log(
      `[piloto] mapeamento informado: clients:${args.expectedSourceClientId} -> ` +
        `organization ${args.targetOrganizationPublicId}`
    );
    log(`[piloto] alvo Ingressa: ${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`);
    log(`[piloto] fonte Helpdesk: ${sourceConfig.user}@${sourceConfig.host}:${sourceConfig.port}/${sourceConfig.database} (read-only)`);

    const resultado = await runner.execute({
      mode: args.mode,
      mapping: {
        expectedSourceClientId: args.expectedSourceClientId,
        targetOrganizationPublicId: args.targetOrganizationPublicId
      },
      dryRunBatchPublicId: args.dryRunBatchPublicId,
      approvedByIdentityPublicId: args.approvedByIdentityPublicId
    });

    log(formatReport(resultado));
    if (args.mode === "DRY_RUN") {
      log("[piloto] nenhuma Identity, Membership ou ApplicationAccess foi criada — isto foi uma simulação.");
    }
    return 0;
  } finally {
    await ingressaPool.end();
    await helpdeskPool.end();
  }
}

const isDirectExecution = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runPilotCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const usage = error instanceof PilotCliUsageError;
      process.stderr.write(`[piloto] ${usage ? "uso inválido" : "erro"}: ${message}\n`);
      process.exitCode = usage ? 1 : 2;
    });
}
