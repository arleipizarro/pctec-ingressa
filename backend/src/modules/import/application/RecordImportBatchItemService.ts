import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import type { ImportBatchItemRepository } from "../domain/ImportBatchItemRepository.js";
import { ImportBatchItem } from "../domain/ImportBatchItem.js";
import { ImportItemSnapshot } from "../domain/ImportItemSnapshot.js";
import { ImportBatchNotFoundError } from "../domain/errors/ImportErrors.js";

export interface RecordImportItemInput {
  readonly entityKind: string;
  readonly sourceEntityType: string;
  readonly sourceLegacyId: string | number;
  readonly action: string;
  readonly targetPublicId?: string | null | undefined;
  /** Whitelist de campos + objeto de origem — nunca o registro bruto. */
  readonly before?: { readonly allowedFields: readonly string[]; readonly source: Record<string, unknown> } | undefined;
  readonly after?: { readonly allowedFields: readonly string[]; readonly source: Record<string, unknown> } | undefined;
  readonly reasonCode?: string | null | undefined;
  readonly errorMessage?: string | null | undefined;
}

export interface RecordImportBatchItemsRequest {
  readonly batchPublicId: string;
  readonly items: readonly RecordImportItemInput[];
}

export interface RecordImportBatchItemsResult {
  readonly batchPublicId: string;
  readonly recorded: number;
  readonly skippedAsAlreadyProcessed: number;
}

/**
 * Registra decisões na trilha do lote.
 *
 * **Retomada.** Antes de gravar, consulta as chaves de origem já
 * decididas neste lote e descarta as repetidas. Um processo morto no
 * meio pode ser reexecutado sobre o MESMO lote sem duplicar a trilha —
 * a idempotência das entidades de destino já é garantida pelas UNIQUE
 * KEYs (`active_match_key`, `uk_membership_unique`,
 * `uk_app_access_active_grant`); esta é a idempotência da auditoria.
 *
 * **Sanitização.** Os snapshots são montados por
 * `ImportItemSnapshot.fromWhitelist`, campo a campo. O chamador não tem
 * como passar o registro bruto da origem: ele passa uma whitelist e um
 * objeto, e só as chaves da whitelist — depois de aprovadas pela
 * denylist — entram.
 */
export class RecordImportBatchItemService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly importBatchRepositoryFactory: (connection: Queryable) => ImportBatchRepository,
    private readonly importBatchItemRepositoryFactory: (connection: Queryable) => ImportBatchItemRepository
  ) {}

  public async execute(request: RecordImportBatchItemsRequest): Promise<RecordImportBatchItemsResult> {
    return this.unitOfWork.runInTransaction(async (connection) => {
      const batchRepository = this.importBatchRepositoryFactory(connection);
      const itemRepository = this.importBatchItemRepositoryFactory(connection);

      const batch = await batchRepository.findByPublicId(request.batchPublicId);
      if (batch === undefined) {
        throw new ImportBatchNotFoundError(request.batchPublicId);
      }
      batch.assertAcceptsItems();

      const jaProcessadas = await itemRepository.findProcessedSourceKeys(request.batchPublicId);
      const isDryRun = batch.getMode().isDryRun();

      const novos: ImportBatchItem[] = [];
      let repetidos = 0;

      for (const input of request.items) {
        const chave = `${input.entityKind}:${input.sourceEntityType}:${String(input.sourceLegacyId)}`;
        if (jaProcessadas.has(chave)) {
          repetidos += 1;
          continue;
        }

        novos.push(
          ImportBatchItem.record({
            batchPublicId: request.batchPublicId,
            batchIsDryRun: isDryRun,
            entityKind: input.entityKind,
            sourceEntityType: input.sourceEntityType,
            sourceLegacyId: input.sourceLegacyId,
            action: input.action,
            targetPublicId: input.targetPublicId ?? null,
            beforeSnapshot:
              input.before === undefined
                ? undefined
                : ImportItemSnapshot.fromWhitelist(input.before.allowedFields, input.before.source),
            afterSnapshot:
              input.after === undefined
                ? undefined
                : ImportItemSnapshot.fromWhitelist(input.after.allowedFields, input.after.source),
            reasonCode: input.reasonCode ?? null,
            errorMessage: input.errorMessage ?? null
          })
        );
      }

      if (novos.length > 0) {
        await itemRepository.insertMany(novos);
      }

      return {
        batchPublicId: request.batchPublicId,
        recorded: novos.length,
        skippedAsAlreadyProcessed: repetidos
      };
    });
  }
}
