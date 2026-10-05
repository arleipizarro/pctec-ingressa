import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { PasswordResetTokenRepository } from "../../domain/PasswordResetTokenRepository.js";
import { PasswordResetToken, type PasswordResetTokenPersistedState } from "../../domain/PasswordResetToken.js";

type Row = Record<string, unknown>;

function readString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de password_reset_tokens.`);
  }
  return value;
}

function readNumber(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de password_reset_tokens.`);
}

function readDate(row: Row, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de password_reset_tokens.`);
}

function readOptionalDate(row: Row, column: string): Date | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(String(value));
}

function readOptionalString(row: Row, column: string): string | undefined {
  const value = row[column];
  return value === null || value === undefined ? undefined : String(value);
}

function mapRow(row: Row): PasswordResetTokenPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    identityPublicId: readString(row, "identity_public_id"),
    tokenHash: readString(row, "token_hash"),
    status: readString(row, "status"),
    correlationId: readString(row, "correlation_id"),
    createdAt: readDate(row, "created_at"),
    expiresAt: readDate(row, "expires_at"),
    consumedAt: readOptionalDate(row, "consumed_at"),
    revokedAt: readOptionalDate(row, "revoked_at"),
    revocationReason: readOptionalString(row, "revocation_reason")
  };
}

const SELECT_COLUMNS = `id, public_id, identity_public_id, token_hash, status, correlation_id,
       created_at, expires_at, consumed_at, revoked_at, revocation_reason`;

/** Implementação MariaDB conforme `0034_create_password_reset_tokens.up.sql`. */
export class MariaDbPasswordResetTokenRepository implements PasswordResetTokenRepository {
  public constructor(private readonly connection: Queryable) {}

  public async insert(token: PasswordResetToken): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO password_reset_tokens
         (public_id, identity_public_id, token_hash, status, correlation_id,
          created_at, expires_at, consumed_at, revoked_at, revocation_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      [
        token.getPublicId().toString(),
        token.getIdentityPublicId(),
        token.getTokenHash(),
        token.getStatus(),
        token.getCorrelationId(),
        token.getCreatedAt(),
        token.getExpiresAt()
      ]
    );
    token.assignInternalIdFromPersistence((result as { insertId: number }).insertId);
  }

  public async revokePendingByIdentity(identityPublicId: string, now: Date, reason: string): Promise<number> {
    const [resultado] = await this.connection.execute(
      `UPDATE password_reset_tokens
          SET status = 'REVOKED', revoked_at = ?, revocation_reason = ?
        WHERE identity_public_id = ? AND status = 'PENDING'`,
      [now, reason, identityPublicId]
    );
    return (resultado as { affectedRows: number }).affectedRows;
  }

  public async countCreatedSince(identityPublicId: string, since: Date): Promise<number> {
    const [rows] = await this.connection.execute(
      `SELECT COUNT(*) AS total
         FROM password_reset_tokens
        WHERE identity_public_id = ? AND created_at >= ?`,
      [identityPublicId, since]
    );
    const row = (rows as Row[])[0];
    return row === undefined ? 0 : readNumber(row, "total");
  }

  public async findUsableByTokenHash(tokenHash: string, now: Date): Promise<PasswordResetToken | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS}
         FROM password_reset_tokens
        WHERE token_hash = ? AND status = 'PENDING' AND expires_at > ?
        LIMIT 1`,
      [tokenHash, now]
    );
    const row = (rows as Row[])[0];
    return row === undefined ? undefined : PasswordResetToken.reconstitute(mapRow(row));
  }

  public async consumeByTokenHash(tokenHash: string, now: Date): Promise<PasswordResetToken | undefined> {
    const [updateResult] = await this.connection.execute(
      `UPDATE password_reset_tokens
          SET status = 'CONSUMED', consumed_at = ?
        WHERE token_hash = ?
          AND status = 'PENDING'
          AND consumed_at IS NULL
          AND expires_at > ?`,
      [now, tokenHash, now]
    );
    if ((updateResult as { affectedRows: number }).affectedRows === 0) {
      return undefined;
    }

    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS} FROM password_reset_tokens WHERE token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    const row = (rows as Row[])[0];
    return row === undefined ? undefined : PasswordResetToken.reconstitute(mapRow(row));
  }
}
