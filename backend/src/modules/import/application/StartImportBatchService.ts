import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import { ImportBatch, type ImportCounts, type ImportSourceSystemValue } from "../domain/ImportBatch.js";
import { ImportBatchMode } from "../domain/value-objects/ImportBatchMode.js";
import { DryRunBatchNotFoundError } from "../domain/errors/ImportErrors.js";

export interface StartImportBatchRequest {
  readonly sourceSystem: ImportSourceSystemValue;
  readonly mode: string;
  readonly mappingRulesVersion: string;
  readonly snapshotFingerprint: string;
  readonly scopeFingerprint: string;
  readonly countsBefore: ImportCounts;
  /** Obrigatório em APPLY. */
  readonly dryRunBatchPublicId?: string | null | undefined;
  /** Obrigatório em APPLY. */
  readonly approvedByIdentityPublicId?: string | null | undefined;
}

export interface StartImportBatchResult {
  readonly batchPublicId: string;
  readonly mode: string;
  readonly status: string;
}

/**
 * Abre um lote de importação.
 *
 * Toda a defesa do apply acontece ANTES de qualquer escrita de domínio:
 * dry-run obrigatório, dry-run concluído, mesmo sistema de origem, mesma
 * versão de regras, mesmo `scopeFingerprint` e aprovação registrada. As
 * regras vivem em `ImportBatch.startApply` — este service só carrega o
 * dry-run e delega, para que a mesma proteção valha venha a chamada de
 * onde vier (CLI hoje, rota administrativa amanhã).
 *
 * Não conhece conector de origem nenhum: recebe fingerprints e contagens
 * já calculados. Nesta fatia (v0.8.x) não existe leitura do Helpdesk.
 */
export class StartImportBatchService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly importBatchRepositoryFactory: (connection: Queryable) => ImportBatchRepository
  ) {}

  public async execute(request: StartImportBatchRequest): Promise<StartImportBatchResult> {
    const mode = ImportBatchMode.create(request.mode);

    return this.unitOfWork.runInTransaction(async (connection) => {
      const repository = this.importBatchRepositoryFactory(connection);

      const batch = mode.isApply()
        ? await this.buildApplyBatch(repository, request)
        : ImportBatch.startDryRun({
            sourceSystem: request.sourceSystem,
            mappingRulesVersion: request.mappingRulesVersion,
            snapshotFingerprint: request.snapshotFingerprint,
            scopeFingerprint: request.scopeFingerprint,
            countsBefore: request.countsBefore
          });

      await repository.insert(batch);

      return {
        batchPublicId: batch.getPublicId(),
        mode: batch.getMode().toString(),
        status: batch.getStatus().toString()
      };
    });
  }

  private async buildApplyBatch(
    repository: ImportBatchRepository,
    request: StartImportBatchRequest
  ): Promise<ImportBatch> {
    ImportBatch.assertDryRunProvided(request.dryRunBatchPublicId);
    const dryRunPublicId = String(request.dryRunBatchPublicId);

    const dryRun = await repository.findByPublicId(dryRunPublicId);
    if (dryRun === undefined) {
      throw new DryRunBatchNotFoundError(dryRunPublicId);
    }

    return ImportBatch.startApply({
      sourceSystem: request.sourceSystem,
      mappingRulesVersion: request.mappingRulesVersion,
      snapshotFingerprint: request.snapshotFingerprint,
      scopeFingerprint: request.scopeFingerprint,
      countsBefore: request.countsBefore,
      dryRunBatch: dryRun,
      approvedByIdentityPublicId: request.approvedByIdentityPublicId ?? ""
    });
  }
}
