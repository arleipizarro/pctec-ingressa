import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { ImportBatchRepository } from "../../domain/ImportBatchRepository.js";
import { ImportBatch, type ImportCounts } from "../../domain/ImportBatch.js";

type Row = Record<string, unknown>;

function readString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de import_batches.`);
  }
  return value;
}

function readOptionalString(row: Row, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : String(value);
}

function readDate(row: Row, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de import_batches.`);
}

function readOptionalDate(row: Row, column: string): Date | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? value : new Date(String(value));
}

function readNumber(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de import_batches.`);
}

/**
 * O driver pode devolver JSON como objeto já parseado ou como string,
 * dependendo da versão/configuração — tratar os dois é mais barato que
 * depender do comportamento.
 */
function readCounts(row: Row, column: string): ImportCounts | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as ImportCounts;
  }
  return value as ImportCounts;
}

export class MariaDbImportBatchRepository implements ImportBatchRepository {
  public constructor(private readonly connection: Queryable) {}

  public async insert(batch: ImportBatch): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO import_batches
         (public_id, source_system, mapping_rules_version, snapshot_fingerprint, scope_fingerprint,
          mode, status, dry_run_batch_public_id, approved_by_identity_public_id, approved_at,
          counts_before, counts_after, failure_reason, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), NULL, NULL, ?, NULL, ?, ?)`,
      [
        batch.getPublicId(),
        batch.getSourceSystem(),
        batch.getMappingRulesVersion().toString(),
        batch.getSnapshotFingerprint().toString(),
        batch.getScopeFingerprint().toString(),
        batch.getMode().toString(),
        batch.getStatus().toString(),
        batch.getDryRunBatchPublicId(),
        batch.getApprovedByIdentityPublicId(),
        batch.getApprovedAt(),
        JSON.stringify(batch.getCountsBefore()),
        batch.getStartedAt(),
        batch.getCreatedAt(),
        batch.getUpdatedAt()
      ]
    );
    const insertResult = result as { insertId: number };
    batch.assignInternalIdFromPersistence(insertResult.insertId);
  }

  /**
   * Só transiciona um lote que ainda esteja RUNNING no banco. A cláusula
   * `AND status = 'RUNNING'` fecha a corrida entre dois processos que
   * tentem encerrar o mesmo lote: o segundo não encontra linha para
   * atualizar e não sobrescreve o desfecho do primeiro.
   */
  public async updateOutcome(batch: ImportBatch): Promise<void> {
    const countsAfter = batch.getCountsAfter();
    await this.connection.execute(
      `UPDATE import_batches
          SET status = ?,
              counts_after = CASE WHEN ? IS NULL THEN NULL ELSE CAST(? AS JSON) END,
              failure_reason = ?,
              finished_at = ?,
              updated_at = ?
        WHERE public_id = ?
          AND status = 'RUNNING'`,
      [
        batch.getStatus().toString(),
        countsAfter === null ? null : JSON.stringify(countsAfter),
        countsAfter === null ? null : JSON.stringify(countsAfter),
        batch.getFailureReason(),
        batch.getFinishedAt(),
        batch.getUpdatedAt(),
        batch.getPublicId()
      ]
    );
  }

  public async findByPublicId(publicId: string): Promise<ImportBatch | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT * FROM import_batches WHERE public_id = ? LIMIT 1`,
      [publicId]
    );
    const list = rows as Row[];
    return list.length === 0 ? undefined : MariaDbImportBatchRepository.toEntity(list[0] as Row);
  }

  public async findRunningBySourceSystem(sourceSystem: string): Promise<ImportBatch | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT * FROM import_batches
        WHERE source_system = ? AND status = 'RUNNING'
        ORDER BY started_at DESC, id DESC
        LIMIT 1`,
      [sourceSystem]
    );
    const list = rows as Row[];
    return list.length === 0 ? undefined : MariaDbImportBatchRepository.toEntity(list[0] as Row);
  }

  private static toEntity(row: Row): ImportBatch {
    return ImportBatch.reconstitute({
      internalId: readNumber(row, "id"),
      publicId: readString(row, "public_id"),
      sourceSystem: readString(row, "source_system"),
      mappingRulesVersion: readString(row, "mapping_rules_version"),
      snapshotFingerprint: readString(row, "snapshot_fingerprint"),
      scopeFingerprint: readString(row, "scope_fingerprint"),
      mode: readString(row, "mode"),
      status: readString(row, "status"),
      dryRunBatchPublicId: readOptionalString(row, "dry_run_batch_public_id"),
      approvedByIdentityPublicId: readOptionalString(row, "approved_by_identity_public_id"),
      approvedAt: readOptionalDate(row, "approved_at"),
      countsBefore: readCounts(row, "counts_before") ?? {},
      countsAfter: readCounts(row, "counts_after"),
      failureReason: readOptionalString(row, "failure_reason"),
      startedAt: readDate(row, "started_at"),
      finishedAt: readOptionalDate(row, "finished_at"),
      createdAt: readDate(row, "created_at"),
      updatedAt: readDate(row, "updated_at")
    });
  }
}
