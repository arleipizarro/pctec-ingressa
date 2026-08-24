import type { ImportBatch } from "./ImportBatch.js";

export interface ImportBatchRepository {
  insert(batch: ImportBatch): Promise<void>;

  /** Persiste a mudança de estado terminal (COMPLETED/FAILED/ABORTED). */
  updateOutcome(batch: ImportBatch): Promise<void>;

  findByPublicId(publicId: string): Promise<ImportBatch | undefined>;

  /**
   * Retomada: encontra o lote RUNNING mais recente de um sistema de
   * origem, se houver. Um lote RUNNING abandonado (processo morto no
   * meio) é o ponto de partida da retomada — não se abre lote novo por
   * cima dele.
   */
  findRunningBySourceSystem(sourceSystem: string): Promise<ImportBatch | undefined>;
}
