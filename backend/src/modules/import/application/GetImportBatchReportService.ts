import type { Queryable } from "../../../shared/database/Queryable.js";
import type { ImportBatchRepository } from "../domain/ImportBatchRepository.js";
import type { ImportBatchItemRepository } from "../domain/ImportBatchItemRepository.js";
import type { ImportCounts } from "../domain/ImportBatch.js";
import { ImportBatchNotFoundError } from "../domain/errors/ImportErrors.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export interface GetImportBatchReportRequest {
  readonly batchPublicId: string;
  readonly action?: string | undefined;
  readonly entityKind?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface ImportBatchReportItem {
  readonly publicId: string;
  readonly entityKind: string;
  readonly sourceEntityType: string;
  readonly sourceLegacyId: string;
  readonly action: string;
  readonly targetPublicId: string | null;
  readonly reasonCode: string | null;
  readonly errorMessage: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  /**
   * Nomes — SÓ os nomes — dos campos cujo valor foi redigido por serem
   * sensíveis pela política ATUAL. Vazio no caso normal. Nunca carrega
   * valor: é o registro seguro de que aquela linha foi escrita sob uma
   * política mais frouxa do que a de hoje.
   */
  readonly redactedFields: readonly string[];
}

export interface ImportBatchReport {
  readonly batchPublicId: string;
  readonly sourceSystem: string;
  readonly mode: string;
  readonly status: string;
  readonly mappingRulesVersion: string;
  readonly scopeFingerprint: string;
  readonly countsBefore: ImportCounts;
  readonly countsAfter: ImportCounts | null;
  readonly countsByAction: Readonly<Record<string, number>>;
  readonly items: readonly ImportBatchReportItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Relatório antes/depois de um lote, paginado.
 *
 * `countsByAction` vem de uma agregação no banco, não da página: o
 * resumo ("3 CREATE, 1 QUARANTINE") precisa ser do lote inteiro mesmo
 * quando a página mostra 50 linhas.
 *
 * Somente leitura — sem `UnitOfWork`, mesma decisão dos demais services
 * de consulta do projeto.
 */
export class GetImportBatchReportService {
  public constructor(
    private readonly connection: Queryable,
    private readonly importBatchRepositoryFactory: (connection: Queryable) => ImportBatchRepository,
    private readonly importBatchItemRepositoryFactory: (connection: Queryable) => ImportBatchItemRepository
  ) {}

  public async execute(request: GetImportBatchReportRequest): Promise<ImportBatchReport> {
    const batchRepository = this.importBatchRepositoryFactory(this.connection);
    const itemRepository = this.importBatchItemRepositoryFactory(this.connection);

    const batch = await batchRepository.findByPublicId(request.batchPublicId);
    if (batch === undefined) {
      throw new ImportBatchNotFoundError(request.batchPublicId);
    }

    const limit = Math.min(Math.max(request.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(request.offset ?? 0, 0);

    const [page, countsByAction] = await Promise.all([
      itemRepository.list({
        batchPublicId: request.batchPublicId,
        action: request.action,
        entityKind: request.entityKind,
        limit,
        offset
      }),
      itemRepository.countByAction(request.batchPublicId)
    ]);

    return {
      batchPublicId: batch.getPublicId(),
      sourceSystem: batch.getSourceSystem(),
      mode: batch.getMode().toString(),
      status: batch.getStatus().toString(),
      mappingRulesVersion: batch.getMappingRulesVersion().toString(),
      scopeFingerprint: batch.getScopeFingerprint().toString(),
      countsBefore: batch.getCountsBefore(),
      countsAfter: batch.getCountsAfter(),
      countsByAction,
      items: page.items.map((item) => ({
        publicId: item.getPublicId(),
        entityKind: item.getEntityKind().toString(),
        sourceEntityType: item.getSourceEntityType(),
        sourceLegacyId: item.getSourceLegacyId(),
        action: item.getAction().toString(),
        targetPublicId: item.getTargetPublicId(),
        reasonCode: item.getReasonCode(),
        errorMessage: item.getErrorMessage(),
        ...GetImportBatchReportService.redigirSnapshots(item)
      })),
      total: page.total,
      limit: page.limit,
      offset: page.offset
    };
  }

  /**
   * Aplica a política ATUAL na SAÍDA, nunca na leitura.
   *
   * Um snapshot histórico pode conter um campo que passou a ser proibido
   * depois de gravado. A reconstituição aceita a linha (ver
   * `ImportItemSnapshot.fromPersistedRecord`); é aqui que o valor é
   * substituído pelo marcador e o nome do campo vai para
   * `redactedFields`. A página inteira continua servível — uma linha
   * antiga não derruba o relatório — e nenhum valor sensível aparece.
   */
  private static redigirSnapshots(item: {
    getBeforeSnapshot(): { toRedactedJSON(): { fields: Readonly<Record<string, unknown>>; redactedFields: readonly string[] } } | null;
    getAfterSnapshot(): { toRedactedJSON(): { fields: Readonly<Record<string, unknown>>; redactedFields: readonly string[] } } | null;
  }): Pick<ImportBatchReportItem, "before" | "after" | "redactedFields"> {
    const antes = item.getBeforeSnapshot()?.toRedactedJSON() ?? null;
    const depois = item.getAfterSnapshot()?.toRedactedJSON() ?? null;

    const redigidos = [...new Set([...(antes?.redactedFields ?? []), ...(depois?.redactedFields ?? [])])].sort((a, b) =>
      a.localeCompare(b, "en")
    );

    return {
      before: antes === null ? null : { ...antes.fields },
      after: depois === null ? null : { ...depois.fields },
      redactedFields: redigidos
    };
  }
}
