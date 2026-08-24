import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import type { ImportCounts } from "../domain/ImportBatch.js";
import { ImportBatchNotFoundError } from "../domain/errors/ImportErrors.js";

export interface CompleteImportBatchRequest {
  readonly batchPublicId: string;
  readonly countsAfter: ImportCounts;
}

export interface FailImportBatchRequest {
  readonly batchPublicId: string;
  readonly reason: string;
}

export interface FinishImportBatchResult {
  readonly batchPublicId: string;
  readonly status: string;
}

/**
 * Encerra um lote: concluir, falhar ou abortar.
 *
 * As transições válidas vivem em `ImportBatchStatus` — RUNNING é o único
 * estado que aceita mudança, e nenhum estado terminal volta atrás.
 * Reabrir um lote concluído apagaria a explicação do que já foi escrito.
 */
export class FinishImportBatchService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly importBatchRepositoryFactory: (connection: Queryable) => ImportBatchRepository
  ) {}

  public async complete(request: CompleteImportBatchRequest): Promise<FinishImportBatchResult> {
    return this.transition(request.batchPublicId, (batch) => {
      batch.complete(request.countsAfter);
    });
  }

  public async fail(request: FailImportBatchRequest): Promise<FinishImportBatchResult> {
    return this.transition(request.batchPublicId, (batch) => {
      batch.fail(request.reason);
    });
  }

  public async abort(request: FailImportBatchRequest): Promise<FinishImportBatchResult> {
    return this.transition(request.batchPublicId, (batch) => {
      batch.abort(request.reason);
    });
  }

  private async transition(
    batchPublicId: string,
    mutate: (batch: import("../domain/ImportBatch.js").ImportBatch) => void
  ): Promise<FinishImportBatchResult> {
    return this.unitOfWork.runInTransaction(async (connection) => {
      const repository = this.importBatchRepositoryFactory(connection);
      const batch = await repository.findByPublicId(batchPublicId);
      if (batch === undefined) {
        throw new ImportBatchNotFoundError(batchPublicId);
      }

      mutate(batch);
      await repository.updateOutcome(batch);

      return { batchPublicId: batch.getPublicId(), status: batch.getStatus().toString() };
    });
  }
}
