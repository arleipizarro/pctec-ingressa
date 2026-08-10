import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { CredentialRepository } from "../../domain/CredentialRepository.js";
import { Credential, type CredentialPersistedState } from "../../domain/Credential.js";
import type { CredentialType } from "../../domain/value-objects/CredentialType.js";
import { CredentialVersionConflictError } from "../../domain/errors/CredentialErrors.js";

type CredentialRow = Record<string, unknown>;

function readString(row: CredentialRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de credentials.`);
  }
  return value;
}

function readNumber(row: CredentialRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de credentials.`);
}

function readDate(row: CredentialRow, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de credentials.`);
}

function readOptionalDate(row: CredentialRow, column: string): Date | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(String(value));
}

function mapRowToPersistedState(row: CredentialRow): CredentialPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    identityPublicId: readString(row, "identity_public_id"),
    type: readString(row, "type"),
    passwordHash: readString(row, "password_hash"),
    status: readString(row, "status"),
    lastAuthenticatedAt: readOptionalDate(row, "last_authenticated_at"),
    version: readNumber(row, "version"),
    createdAt: readDate(row, "created_at"),
    updatedAt: readDate(row, "updated_at")
  };
}

/**
 * Implementação MariaDB de CredentialRepository, conforme
 * `0008_create_credentials.up.sql`. SQL sempre parametrizado, nunca
 * concatenado com entrada.
 */
export class MariaDbCredentialRepository implements CredentialRepository {
  public constructor(private readonly connection: Queryable) {}

  public async insert(credential: Credential): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO credentials
         (public_id, identity_public_id, type, password_hash, status,
          last_authenticated_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        credential.getPublicId().toString(),
        credential.getIdentityPublicId(),
        credential.getType().toString(),
        credential.getPasswordHash().toString(),
        credential.getStatus().toString(),
        credential.getLastAuthenticatedAt() ?? null,
        credential.getVersion(),
        credential.getCreatedAt(),
        credential.getUpdatedAt()
      ]
    );
    const insertResult = result as { insertId: number };
    credential.assignInternalIdFromPersistence(insertResult.insertId);
  }

  public async findByIdentityAndType(
    identityPublicId: string,
    type: CredentialType
  ): Promise<Credential | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, identity_public_id, type, password_hash, status,
              last_authenticated_at, version, created_at, updated_at
         FROM credentials
        WHERE identity_public_id = ?
          AND type = ?
        LIMIT 1`,
      [identityPublicId, type.toString()]
    );
    const rowList = rows as CredentialRow[];
    const row = rowList[0];
    return row === undefined ? undefined : Credential.reconstitute(mapRowToPersistedState(row));
  }

  public async existsAnyByType(type: CredentialType): Promise<boolean> {
    const [rows] = await this.connection.execute(`SELECT 1 FROM credentials WHERE type = ? LIMIT 1`, [
      type.toString()
    ]);
    return (rows as unknown[]).length > 0;
  }

  /**
   * `SET version = ?` recebe o valor ABSOLUTO atual de
   * `credential.getVersion()` (não um incremento relativo hardcoded) —
   * mesmo princípio já corrigido em `MariaDbIdentityRepository.update()`
   * (v0.5.x): evita divergência entre memória e banco se, no futuro, mais
   * de uma mutação de domínio ocorrer antes de uma única chamada a
   * `update()`.
   */
  public async update(credential: Credential, expectedVersion: number): Promise<void> {
    const [result] = await this.connection.execute(
      `UPDATE credentials
          SET last_authenticated_at = ?,
              status = ?,
              version = ?,
              updated_at = ?
        WHERE public_id = ?
          AND version = ?`,
      [
        credential.getLastAuthenticatedAt() ?? null,
        credential.getStatus().toString(),
        credential.getVersion(),
        credential.getUpdatedAt(),
        credential.getPublicId().toString(),
        expectedVersion
      ]
    );
    const updateResult = result as { affectedRows: number };
    if (updateResult.affectedRows === 0) {
      throw new CredentialVersionConflictError(expectedVersion, credential.getVersion());
    }
  }
}
