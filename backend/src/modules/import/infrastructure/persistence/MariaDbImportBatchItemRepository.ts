import type { Queryable } from "../../../../shared/database/Queryable.js";
import type {
  ImportBatchItemPage,
  ImportBatchItemRepository,
  ListImportBatchItemsQuery
} from "../../domain/ImportBatchItemRepository.js";
import { ImportBatchItem } from "../../domain/ImportBatchItem.js";

type Row = Record<string, unknown>;

function readString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de import_batch_items.`);
  }
  return value;
}

function readOptionalString(row: Row, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : String(value);
}

function readNumber(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de import_batch_items.`);
}

function readDate(row: Row, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de import_batch_items.`);
}

function readJson(row: Row, column: string): Record<string, unknown> | null {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

export class MariaDbImportBatchItemRepository implements ImportBatchItemRepository {
  public constructor(private readonly connection: Queryable) {}

  public async insert(item: ImportBatchItem): Promise<void> {
    await this.insertMany([item]);
  }

  public async insertMany(items: readonly ImportBatchItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    // Uma instrução com múltiplos VALUES: um lote de AFIP grava ~8 itens,
    // um de IRSSL grava centenas. Um INSERT por item multiplicaria os
    // round-trips sem nenhum ganho de clareza.
    // `before_snapshot`/`after_snapshot` são colunas JSON e recebem a
    // string JSON crua — sem `CAST(? AS JSON)`. No MariaDB, `JSON` é
    // apelido de `LONGTEXT` com CHECK `json_valid(...)`, e
    // `CAST(... AS JSON)` não existe na gramática (é sintaxe do MySQL 8).
    const placeholders = items.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params: unknown[] = [];

    for (const item of items) {
      const before = item.getBeforeSnapshot();
      const after = item.getAfterSnapshot();
      params.push(
        item.getPublicId(),
        item.getBatchPublicId(),
        item.getEntityKind().toString(),
        item.getSourceEntityType(),
        item.getSourceLegacyId(),
        item.getAction().toString(),
        item.getTargetPublicId(),
        before === null ? null : JSON.stringify(before.toJSON()),
        after === null ? null : JSON.stringify(after.toJSON()),
        item.getReasonCode(),
        item.getErrorMessage(),
        item.getCreatedAt()
      );
    }

    const [result] = await this.connection.execute(
      `INSERT INTO import_batch_items
         (public_id, batch_public_id, entity_kind, source_entity_type, source_legacy_id,
          action, target_public_id, before_snapshot, after_snapshot, reason_code, error_message, created_at)
       VALUES ${placeholders}`,
      params
    );

    // MariaDB devolve o id da PRIMEIRA linha do INSERT múltiplo; os
    // demais são sequenciais.
    const insertResult = result as { insertId: number };
    items.forEach((item, index) => {
      item.assignInternalIdFromPersistence(insertResult.insertId + index);
    });
  }

  public async list(query: ListImportBatchItemsQuery): Promise<ImportBatchItemPage> {
    const where: string[] = ["batch_public_id = ?"];
    const params: unknown[] = [query.batchPublicId];

    if (query.action !== undefined) {
      where.push("action = ?");
      params.push(query.action);
    }
    if (query.entityKind !== undefined) {
      where.push("entity_kind = ?");
      params.push(query.entityKind);
    }

    const whereSql = where.join(" AND ");

    const [countRows] = await this.connection.execute(
      `SELECT COUNT(*) AS total FROM import_batch_items WHERE ${whereSql}`,
      params
    );
    const total = readNumber((countRows as Row[])[0] as Row, "total");

    const [rows] = await this.connection.execute(
      `SELECT * FROM import_batch_items
        WHERE ${whereSql}
        ORDER BY id ASC
        LIMIT ? OFFSET ?`,
      [...params, query.limit, query.offset]
    );

    return {
      items: (rows as Row[]).map((row) => MariaDbImportBatchItemRepository.toEntity(row)),
      total,
      limit: query.limit,
      offset: query.offset
    };
  }

  public async countByAction(batchPublicId: string): Promise<Readonly<Record<string, number>>> {
    const [rows] = await this.connection.execute(
      `SELECT action, COUNT(*) AS total
         FROM import_batch_items
        WHERE batch_public_id = ?
        GROUP BY action`,
      [batchPublicId]
    );

    const resultado: Record<string, number> = {};
    for (const row of rows as Row[]) {
      resultado[readString(row, "action")] = readNumber(row, "total");
    }
    return resultado;
  }

  public async findProcessedSourceKeys(batchPublicId: string): Promise<ReadonlySet<string>> {
    const [rows] = await this.connection.execute(
      `SELECT entity_kind, source_entity_type, source_legacy_id
         FROM import_batch_items
        WHERE batch_public_id = ?`,
      [batchPublicId]
    );

    const chaves = new Set<string>();
    for (const row of rows as Row[]) {
      chaves.add(
        `${readString(row, "entity_kind")}:${readString(row, "source_entity_type")}:${String(row["source_legacy_id"])}`
      );
    }
    return chaves;
  }

  private static toEntity(row: Row): ImportBatchItem {
    return ImportBatchItem.reconstitute({
      internalId: readNumber(row, "id"),
      publicId: readString(row, "public_id"),
      batchPublicId: readString(row, "batch_public_id"),
      entityKind: readString(row, "entity_kind"),
      sourceEntityType: readString(row, "source_entity_type"),
      sourceLegacyId: String(row["source_legacy_id"]),
      action: readString(row, "action"),
      targetPublicId: readOptionalString(row, "target_public_id"),
      beforeSnapshot: readJson(row, "before_snapshot"),
      afterSnapshot: readJson(row, "after_snapshot"),
      reasonCode: readOptionalString(row, "reason_code"),
      errorMessage: readOptionalString(row, "error_message"),
      createdAt: readDate(row, "created_at")
    });
  }
}
