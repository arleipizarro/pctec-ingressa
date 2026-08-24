import type { ImportBatchItem } from "./ImportBatchItem.js";

export interface ImportBatchItemPage {
  readonly items: readonly ImportBatchItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface ListImportBatchItemsQuery {
  readonly batchPublicId: string;
  readonly action?: string | undefined;
  readonly entityKind?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface ImportBatchItemRepository {
  insert(item: ImportBatchItem): Promise<void>;

  insertMany(items: readonly ImportBatchItem[]): Promise<void>;

  /**
   * Relatório paginado. Um lote de AFIP tem poucos itens; um lote de
   * IRSSL (10 empresas, 44 externos) já produz centenas, e a base
   * inteira produziria milhares. Carregar tudo em memória para exibir
   * as 50 primeiras linhas não escala e não é necessário.
   */
  list(query: ListImportBatchItemsQuery): Promise<ImportBatchItemPage>;

  /** Contagem por ação — alimenta o resumo do relatório sem paginar. */
  countByAction(batchPublicId: string): Promise<Readonly<Record<string, number>>>;

  /**
   * Retomada: chaves de origem já decididas neste lote, para que o
   * reprocessamento não gere itens duplicados na trilha.
   */
  findProcessedSourceKeys(batchPublicId: string): Promise<ReadonlySet<string>>;
}
