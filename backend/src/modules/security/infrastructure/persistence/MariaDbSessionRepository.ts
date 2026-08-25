import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { SessionRepository } from "../../domain/session/SessionRepository.js";
import { Session, type SessionPersistedState } from "../../domain/session/Session.js";
import { SessionVersionConflictError } from "../../domain/session/errors/SessionErrors.js";

type SessionRow = Record<string, unknown>;

function readString(row: SessionRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de sessions.`);
  }
  return value;
}

function readNumber(row: SessionRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de sessions.`);
}

function readDate(row: SessionRow, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de sessions.`);
}

function readOptionalDate(row: SessionRow, column: string): Date | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(String(value));
}

function readOptionalString(row: SessionRow, column: string): string | undefined {
  const value = row[column];
  return value === null || value === undefined ? undefined : String(value);
}

function mapRowToPersistedState(row: SessionRow): SessionPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    identityPublicId: readString(row, "identity_public_id"),
    tokenHash: readString(row, "token_hash"),
    status: readString(row, "status"),
    createdAt: readDate(row, "created_at"),
    expiresAt: readDate(row, "expires_at"),
    lastSeenAt: readOptionalDate(row, "last_seen_at"),
    revokedAt: readOptionalDate(row, "revoked_at"),
    revocationReason: readOptionalString(row, "revocation_reason"),
    version: readNumber(row, "version")
  };
}

const SELECT_COLUMNS = `id, public_id, identity_public_id, token_hash, status, created_at,
       expires_at, last_seen_at, revoked_at, revocation_reason, version`;

/**
 * Implementação MariaDB de SessionRepository, conforme
 * `0009_create_sessions.up.sql`. SQL sempre parametrizado, nunca
 * concatenado com entrada.
 */
export class MariaDbSessionRepository implements SessionRepository {
  public constructor(private readonly connection: Queryable) {}

  /**
   * Sessões ainda válidas de uma Identity. `status = 'ACTIVE'` e
   * `expires_at > NOW()`: uma sessão expirada já não autentica, então
   * revogá-la seria escrita sem efeito.
   */
  public async findActiveByIdentityPublicId(identityPublicId: string): Promise<readonly Session[]> {
    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS}
         FROM sessions
        WHERE identity_public_id = ? AND status = 'ACTIVE' AND expires_at > NOW()
        ORDER BY id`,
      [identityPublicId]
    );
    return (rows as SessionRow[]).map((row) => Session.reconstitute(mapRowToPersistedState(row)));
  }

  public async insert(session: Session): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO sessions
         (public_id, identity_public_id, token_hash, status, created_at,
          expires_at, last_seen_at, revoked_at, revocation_reason, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.getPublicId().toString(),
        session.getIdentityPublicId(),
        session.getTokenHash(),
        session.getStatus(),
        session.getCreatedAt(),
        session.getExpiresAt(),
        session.getLastSeenAt() ?? null,
        session.getRevokedAt() ?? null,
        session.getRevocationReason() ?? null,
        session.getVersion()
      ]
    );
    const insertResult = result as { insertId: number };
    session.assignInternalIdFromPersistence(insertResult.insertId);
  }

  public async findByTokenHash(tokenHash: string): Promise<Session | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS} FROM sessions WHERE token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    const rowList = rows as SessionRow[];
    const row = rowList[0];
    return row === undefined ? undefined : Session.reconstitute(mapRowToPersistedState(row));
  }

  public async findByPublicId(publicId: string): Promise<Session | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS} FROM sessions WHERE public_id = ? LIMIT 1`,
      [publicId]
    );
    const rowList = rows as SessionRow[];
    const row = rowList[0];
    return row === undefined ? undefined : Session.reconstitute(mapRowToPersistedState(row));
  }

  /**
   * `SET version = ?` recebe o valor ABSOLUTO atual de
   * `session.getVersion()` (não um incremento relativo hardcoded) —
   * mesmo princípio já corrigido em `MariaDbIdentityRepository.update()`/
   * `MariaDbCredentialRepository.update()`.
   */
  public async update(session: Session, expectedVersion: number): Promise<void> {
    const [result] = await this.connection.execute(
      `UPDATE sessions
          SET status = ?,
              last_seen_at = ?,
              revoked_at = ?,
              revocation_reason = ?,
              version = ?
        WHERE public_id = ?
          AND version = ?`,
      [
        session.getStatus(),
        session.getLastSeenAt() ?? null,
        session.getRevokedAt() ?? null,
        session.getRevocationReason() ?? null,
        session.getVersion(),
        session.getPublicId().toString(),
        expectedVersion
      ]
    );
    const updateResult = result as { affectedRows: number };
    if (updateResult.affectedRows === 0) {
      throw new SessionVersionConflictError(expectedVersion, session.getVersion());
    }
  }
}
