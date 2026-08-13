import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { IdentityExternalReferenceRepository } from "../../domain/IdentityExternalReferenceRepository.js";
import {
  IdentityExternalReference,
  type IdentityExternalReferencePersistedState
} from "../../domain/IdentityExternalReference.js";
import { IdentityExternalReferenceAlreadyExistsError } from "../../domain/errors/IdentityExternalReferenceErrors.js";
import type { PublicId } from "../../domain/value-objects/PublicId.js";
import type { SystemCode } from "../../domain/value-objects/SystemCode.js";
import type { EntityType } from "../../domain/value-objects/EntityType.js";
import type { LegacyId } from "../../domain/value-objects/LegacyId.js";

/** Nome da UNIQUE KEY sobre a coluna gerada `active_match_key` (migration 0016). */
const ACTIVE_MATCH_UNIQUE_KEY_NAME = "uk_id_ext_ref_active_match";

type IdentityExternalReferenceRow = Record<string, unknown>;

function readString(row: IdentityExternalReferenceRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de identity_external_references.`);
  }
  return value;
}

function readNumber(row: IdentityExternalReferenceRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de identity_external_references.`);
}

function readDate(row: IdentityExternalReferenceRow, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de identity_external_references.`);
}

function mapRowToPersistedState(row: IdentityExternalReferenceRow): IdentityExternalReferencePersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    identityPublicId: readString(row, "identity_public_id"),
    systemCode: readString(row, "system_code"),
    entityType: readString(row, "entity_type"),
    legacyId: readNumber(row, "legacy_id"),
    matchMethod: readString(row, "match_method"),
    status: readString(row, "status"),
    createdAt: readDate(row, "created_at"),
    updatedAt: readDate(row, "updated_at")
  };
}

/**
 * Implementação MariaDB de IdentityExternalReferenceRepository,
 * conforme `0016_create_identity_external_references.up.sql`. Todas
 * as queries usam parâmetros preparados (`?`), nunca concatenação de SQL
 * com entrada.
 */
export class MariaDbIdentityExternalReferenceRepository implements IdentityExternalReferenceRepository {
  public constructor(private readonly connection: Queryable) {}

  public async findByPublicId(publicId: PublicId): Promise<IdentityExternalReference | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, identity_public_id, system_code, entity_type, legacy_id,
              match_method, status, created_at, updated_at
         FROM identity_external_references
        WHERE public_id = ?
        LIMIT 1`,
      [publicId.toString()]
    );
    const rowList = rows as IdentityExternalReferenceRow[];
    const row = rowList[0];
    return row === undefined ? undefined : IdentityExternalReference.reconstitute(mapRowToPersistedState(row));
  }

  public async existsActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1 FROM identity_external_references
        WHERE system_code = ? AND entity_type = ? AND legacy_id = ? AND status = 'ACTIVE'
        LIMIT 1`,
      [systemCode.toString(), entityType.toString(), legacyId.toNumber()]
    );
    return (rows as IdentityExternalReferenceRow[]).length > 0;
  }

  public async findActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<IdentityExternalReference | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, identity_public_id, system_code, entity_type, legacy_id,
              match_method, status, created_at, updated_at
         FROM identity_external_references
        WHERE system_code = ? AND entity_type = ? AND legacy_id = ? AND status = 'ACTIVE'
        LIMIT 1`,
      [systemCode.toString(), entityType.toString(), legacyId.toNumber()]
    );
    const rowList = rows as IdentityExternalReferenceRow[];
    const row = rowList[0];
    return row === undefined ? undefined : IdentityExternalReference.reconstitute(mapRowToPersistedState(row));
  }

  /**
   * A checagem otimista (`existsActiveBySystemCodeEntityTypeAndLegacyId`,
   * chamada pelo Application Service antes deste `insert`) cobre o caso
   * comum com uma mensagem de erro de domínio amigável, mas **não é a
   * garantia real sob concorrência** — essa é a `UNIQUE KEY
   * uk_id_ext_ref_active_match`, sobre a coluna gerada `active_match_key`
   * (migration 0016). Se duas transações concorrentes perderem a checagem
   * otimista ao mesmo tempo, o INSERT que chegar por último ao banco falha
   * com erro de chave duplicada real — capturado aqui e traduzido de volta
   * para o MESMO erro de domínio, preservando o contrato do Application
   * Service (sempre erro de domínio, nunca um erro bruto de driver).
   */
  public async insert(reference: IdentityExternalReference): Promise<void> {
    try {
      const [result] = await this.connection.execute(
        `INSERT INTO identity_external_references
           (public_id, identity_public_id, system_code, entity_type, legacy_id,
            match_method, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reference.getPublicId().toString(),
          reference.getIdentityPublicId(),
          reference.getSystemCode().toString(),
          reference.getEntityType().toString(),
          reference.getLegacyId().toNumber(),
          reference.getMatchMethod().toString(),
          reference.getStatus(),
          reference.getCreatedAt(),
          reference.getUpdatedAt()
        ]
      );
      const insertResult = result as { insertId: number };
      reference.assignInternalIdFromPersistence(insertResult.insertId);
    } catch (error) {
      if (isDuplicateEntryFor(error, ACTIVE_MATCH_UNIQUE_KEY_NAME)) {
        throw new IdentityExternalReferenceAlreadyExistsError();
      }
      throw error;
    }
  }
}

/**
 * Detecta especificamente um erro de chave duplicada do MariaDB
 * (`ER_DUP_ENTRY`, errno 1062) sobre a UNIQUE KEY nomeada — nunca
 * intercepta duplicidade em OUTRA constraint (ex.: `uk_id_ext_ref_public_id`,
 * que indicaria um bug de geração de UUID, não esta invariante de negócio).
 */
function isDuplicateEntryFor(error: unknown, keyName: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; errno?: unknown; message?: unknown };
  const isDuplicateEntry = candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
  const mentionsKey = typeof candidate.message === "string" && candidate.message.includes(keyName);
  return isDuplicateEntry && mentionsKey;
}
