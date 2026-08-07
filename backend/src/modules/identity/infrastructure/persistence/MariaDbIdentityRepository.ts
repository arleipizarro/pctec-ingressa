import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { IdentityRepository } from "../../domain/IdentityRepository.js";
import { Identity, type IdentityPersistedState } from "../../domain/Identity.js";
import type { PublicId } from "../../domain/value-objects/PublicId.js";
import { IdentityVersionConflictError } from "../../domain/errors/IdentityErrors.js";

/** Formato de uma linha da tabela `identities`, tal como retornada por mysql2. */
type IdentityRow = Record<string, unknown>;

function readString(row: IdentityRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de identities.`);
  }
  return value;
}

function readOptionalString(row: IdentityRow, column: string): string | undefined {
  const value = row[column];
  return value === null || value === undefined ? undefined : String(value);
}

function readNumber(row: IdentityRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de identities.`);
}

function readBoolean(row: IdentityRow, column: string): boolean {
  const value = row[column];
  return value === 1 || value === true || value === "1";
}

function readDate(row: IdentityRow, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de identities.`);
}

function readOptionalDate(row: IdentityRow, column: string): Date | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(String(value));
}

function mapRowToPersistedState(row: IdentityRow): IdentityPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    type: readString(row, "type"),
    fullName: readString(row, "full_name"),
    email: readString(row, "email"),
    emailNormalized: readString(row, "email_normalized"),
    cpf: readOptionalString(row, "cpf"),
    cpfNormalized: readOptionalString(row, "cpf_normalized"),
    status: readString(row, "status"),
    loginEnabled: readBoolean(row, "login_enabled"),
    version: readNumber(row, "version"),
    createdAt: readDate(row, "created_at"),
    createdByPublicId: readOptionalString(row, "created_by_identity_public_id"),
    updatedAt: readDate(row, "updated_at"),
    updatedByPublicId: readOptionalString(row, "updated_by_identity_public_id"),
    deletedAt: readOptionalDate(row, "deleted_at"),
    deletedByPublicId: readOptionalString(row, "deleted_by_identity_public_id"),
    deletionReason: readOptionalString(row, "deletion_reason")
  };
}

/**
 * Implementação MariaDB de IdentityRepository, conforme
 * docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md, seção 1 (tabela
 * `identities`, convenção `id` interno / `public_id` externo — ADR-021).
 *
 * Todas as queries usam parâmetros preparados (`?`), nunca concatenação
 * de SQL com entrada do usuário.
 */
export class MariaDbIdentityRepository implements IdentityRepository {
  public constructor(private readonly connection: Queryable) {}

  public async findByPublicId(publicId: PublicId): Promise<Identity | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, type, full_name, email, email_normalized, cpf, cpf_normalized,
              status, login_enabled, version, created_at, created_by_identity_public_id,
              updated_at, updated_by_identity_public_id, deleted_at, deleted_by_identity_public_id,
              deletion_reason
         FROM identities
        WHERE public_id = ?
        LIMIT 1`,
      [publicId.toString()]
    );
    const rowList = rows as IdentityRow[];
    const row = rowList[0];
    if (row === undefined) {
      return undefined;
    }
    return Identity.reconstitute(mapRowToPersistedState(row));
  }

  public async existsByNormalizedEmail(normalizedEmail: string): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1 FROM identities WHERE email_normalized = ? LIMIT 1`,
      [normalizedEmail]
    );
    return (rows as IdentityRow[]).length > 0;
  }

  public async existsByNormalizedCpf(normalizedCpf: string): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1 FROM identities WHERE cpf_normalized = ? LIMIT 1`,
      [normalizedCpf]
    );
    return (rows as IdentityRow[]).length > 0;
  }

  public async countAll(): Promise<number> {
    const [rows] = await this.connection.execute(`SELECT COUNT(*) AS total FROM identities`);
    const row = (rows as Array<Record<string, unknown>>)[0];
    return Number(row?.["total"] ?? 0);
  }

  public async insert(identity: Identity): Promise<void> {
    const cpf = identity.getCpf();
    const createdBy = identity.getCreatedAtActorPublicIdForPersistence();
    const [result] = await this.connection.execute(
      `INSERT INTO identities
         (public_id, type, full_name, email, email_normalized, cpf, cpf_normalized,
          status, login_enabled, version, created_at, created_by_identity_public_id,
          updated_at, updated_by_identity_public_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        identity.getPublicId().toString(),
        identity.getType().toString(),
        identity.getFullName().toString(),
        identity.getEmail().toString(),
        identity.getEmail().normalized(),
        cpf?.toString() ?? null,
        cpf?.normalized() ?? null,
        identity.getStatus().toString(),
        identity.isLoginEnabled() ? 1 : 0,
        identity.getVersion(),
        identity.getCreatedAt(),
        createdBy ?? null,
        identity.getUpdatedAt(),
        createdBy ?? null
      ]
    );
    const insertResult = result as { insertId: number };
    identity.assignInternalIdFromPersistence(insertResult.insertId);
  }

  public async update(identity: Identity, expectedVersion: number): Promise<void> {
    const cpf = identity.getCpf();
    const deletedBy = identity.getDeletedByPublicIdForPersistence();
    const [result] = await this.connection.execute(
      `UPDATE identities
          SET full_name = ?,
              email = ?,
              email_normalized = ?,
              cpf = ?,
              cpf_normalized = ?,
              status = ?,
              login_enabled = ?,
              version = version + 1,
              updated_at = ?,
              updated_by_identity_public_id = ?,
              deleted_at = ?,
              deleted_by_identity_public_id = ?,
              deletion_reason = ?
        WHERE public_id = ?
          AND version = ?`,
      [
        identity.getFullName().toString(),
        identity.getEmail().toString(),
        identity.getEmail().normalized(),
        cpf?.toString() ?? null,
        cpf?.normalized() ?? null,
        identity.getStatus().toString(),
        identity.isLoginEnabled() ? 1 : 0,
        identity.getUpdatedAt(),
        identity.getUpdatedByPublicIdForPersistence() ?? null,
        identity.getDeletedAt() ?? null,
        deletedBy ?? null,
        identity.getDeletionReason()?.toString() ?? null,
        identity.getPublicId().toString(),
        expectedVersion
      ]
    );
    const updateResult = result as { affectedRows: number };
    if (updateResult.affectedRows === 0) {
      throw new IdentityVersionConflictError(expectedVersion, identity.getVersion());
    }
  }
}
