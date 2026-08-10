import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { ApplicationAccessRepository } from "../../domain/ApplicationAccessRepository.js";
import { ApplicationAccess, type ApplicationAccessPersistedState } from "../../domain/ApplicationAccess.js";

type ApplicationAccessRow = Record<string, unknown>;

function readString(row: ApplicationAccessRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de application_accesses.`);
  }
  return value;
}

function readNumber(row: ApplicationAccessRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de application_accesses.`);
}

function readDate(row: ApplicationAccessRow, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de application_accesses.`);
}

function readOptionalString(row: ApplicationAccessRow, column: string): string | undefined {
  const value = row[column];
  return value === null || value === undefined ? undefined : String(value);
}

function readOptionalDate(row: ApplicationAccessRow, column: string): Date | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(String(value));
}

function mapRowToPersistedState(row: ApplicationAccessRow): ApplicationAccessPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    identityPublicId: readString(row, "identity_public_id"),
    applicationPublicId: readString(row, "application_public_id"),
    accessProfile: readString(row, "access_profile"),
    status: readString(row, "status"),
    grantedAt: readDate(row, "granted_at"),
    grantedByIdentityPublicId: readOptionalString(row, "granted_by_identity_public_id"),
    revokedAt: readOptionalDate(row, "revoked_at"),
    revokedByIdentityPublicId: readOptionalString(row, "revoked_by_identity_public_id"),
    version: readNumber(row, "version"),
    createdAt: readDate(row, "created_at"),
    updatedAt: readDate(row, "updated_at")
  };
}

const SELECT_COLUMNS = `id, public_id, identity_public_id, application_public_id, access_profile,
       status, granted_at, granted_by_identity_public_id, revoked_at,
       revoked_by_identity_public_id, version, created_at, updated_at`;

/**
 * Implementação MariaDB de ApplicationAccessRepository, conforme
 * `0005_create_applications_and_application_accesses.up.sql`. SQL sempre
 * parametrizado.
 */
export class MariaDbApplicationAccessRepository implements ApplicationAccessRepository {
  public constructor(private readonly connection: Queryable) {}

  public async existsGrantedByApplicationAndProfile(
    applicationPublicId: string,
    accessProfile: string
  ): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1
         FROM application_accesses
        WHERE application_public_id = ?
          AND access_profile = ?
          AND status = 'GRANTED'
        LIMIT 1`,
      [applicationPublicId, accessProfile]
    );
    return (rows as unknown[]).length > 0;
  }

  public async existsGrantedByIdentityApplicationAndProfile(
    identityPublicId: string,
    applicationPublicId: string,
    accessProfile: string
  ): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1
         FROM application_accesses
        WHERE identity_public_id = ?
          AND application_public_id = ?
          AND access_profile = ?
          AND status = 'GRANTED'
        LIMIT 1`,
      [identityPublicId, applicationPublicId, accessProfile]
    );
    return (rows as unknown[]).length > 0;
  }

  public async insert(applicationAccess: ApplicationAccess): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO application_accesses
         (public_id, identity_public_id, application_public_id, access_profile,
          status, granted_at, granted_by_identity_public_id, revoked_at,
          revoked_by_identity_public_id, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationAccess.getPublicId().toString(),
        applicationAccess.getIdentityPublicId(),
        applicationAccess.getApplicationPublicId(),
        applicationAccess.getAccessProfile().toString(),
        applicationAccess.getStatus(),
        applicationAccess.getGrantedAt(),
        applicationAccess.getGrantedByIdentityPublicId() ?? null,
        null, // revoked_at — sempre NULL na concessão inicial
        null, // revoked_by_identity_public_id — sempre NULL na concessão inicial
        applicationAccess.getVersion(),
        applicationAccess.getGrantedAt(),
        applicationAccess.getGrantedAt()
      ]
    );
    const insertResult = result as { insertId: number };
    applicationAccess.assignInternalIdFromPersistence(insertResult.insertId);
  }

  public async findByIdentityAndApplication(
    identityPublicId: string,
    applicationPublicId: string
  ): Promise<ApplicationAccess | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS}
         FROM application_accesses
        WHERE identity_public_id = ?
          AND application_public_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [identityPublicId, applicationPublicId]
    );
    const rowList = rows as ApplicationAccessRow[];
    const row = rowList[0];
    return row === undefined ? undefined : ApplicationAccess.reconstitute(mapRowToPersistedState(row));
  }
}
