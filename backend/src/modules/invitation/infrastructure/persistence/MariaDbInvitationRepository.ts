import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { InvitationRepository } from "../../domain/InvitationRepository.js";
import { Invitation, type InvitationPersistedState } from "../../domain/Invitation.js";

type Row = Record<string, unknown>;

function readString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de identity_invitations.`);
  }
  return value;
}

function readNumber(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de identity_invitations.`);
}

function readDate(row: Row, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de identity_invitations.`);
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

function mapRow(row: Row): InvitationPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    identityPublicId: readString(row, "identity_public_id"),
    tokenHash: readString(row, "token_hash"),
    status: readString(row, "status"),
    deliveryMode: readString(row, "delivery_mode"),
    invitedByPublicId: readString(row, "invited_by_public_id"),
    correlationId: readString(row, "correlation_id"),
    createdAt: readDate(row, "created_at"),
    expiresAt: readDate(row, "expires_at"),
    consumedAt: readOptionalDate(row, "consumed_at"),
    revokedAt: readOptionalDate(row, "revoked_at"),
    revocationReason: readOptionalString(row, "revocation_reason")
  };
}

const SELECT_COLUMNS = `id, public_id, identity_public_id, token_hash, status, delivery_mode,
       invited_by_public_id, correlation_id, created_at, expires_at,
       consumed_at, revoked_at, revocation_reason`;

/** Implementação MariaDB conforme `0023_create_identity_invitations.up.sql`. */
export class MariaDbInvitationRepository implements InvitationRepository {
  public constructor(private readonly connection: Queryable) {}

  public async insert(invitation: Invitation): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO identity_invitations
         (public_id, identity_public_id, token_hash, status, delivery_mode,
          invited_by_public_id, correlation_id, created_at, expires_at,
          consumed_at, revoked_at, revocation_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      [
        invitation.getPublicId().toString(),
        invitation.getIdentityPublicId(),
        invitation.getTokenHash(),
        invitation.getStatus(),
        invitation.getDeliveryMode(),
        invitation.getInvitedByPublicId(),
        invitation.getCorrelationId(),
        invitation.getCreatedAt(),
        invitation.getExpiresAt()
      ]
    );
    invitation.assignInternalIdFromPersistence((result as { insertId: number }).insertId);
  }

  /**
   * Lê os PENDING primeiro, revoga depois, e devolve os lidos.
   *
   * Aqui a ordem inversa (leitura antes da escrita) é correta e não
   * abre corrida: os dois passos rodam na MESMA transação do convite
   * novo, e quem perder a corrida encontra o registro já revogado — o
   * pior caso é um evento de auditoria a menos, nunca um convite antigo
   * sobrevivente.
   */
  public async revokePendingByIdentity(
    identityPublicId: string,
    now: Date,
    reason: string
  ): Promise<readonly Invitation[]> {
    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS}
         FROM identity_invitations
        WHERE identity_public_id = ? AND status = 'PENDING'`,
      [identityPublicId]
    );
    const pendentes = (rows as Row[]).map((row) => Invitation.reconstitute(mapRow(row)));
    if (pendentes.length === 0) {
      return [];
    }

    await this.connection.execute(
      `UPDATE identity_invitations
          SET status = 'REVOKED', revoked_at = ?, revocation_reason = ?
        WHERE identity_public_id = ? AND status = 'PENDING'`,
      [now, reason, identityPublicId]
    );

    for (const invitation of pendentes) {
      invitation.markRevoked(now, reason);
    }
    return pendentes;
  }

  public async revokeByPublicId(publicId: string, now: Date, reason: string): Promise<Invitation | undefined> {
    const [resultado] = await this.connection.execute(
      `UPDATE identity_invitations
          SET status = 'REVOKED', revoked_at = ?, revocation_reason = ?
        WHERE public_id = ? AND status = 'PENDING'`,
      [now, reason, publicId]
    );
    if ((resultado as { affectedRows: number }).affectedRows === 0) {
      return undefined;
    }

    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS} FROM identity_invitations WHERE public_id = ? LIMIT 1`,
      [publicId]
    );
    const row = (rows as Row[])[0];
    return row === undefined ? undefined : Invitation.reconstitute(mapRow(row));
  }

  public async findUsableByTokenHash(tokenHash: string, now: Date): Promise<Invitation | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS}
         FROM identity_invitations
        WHERE token_hash = ? AND status = 'PENDING' AND expires_at > ?
        LIMIT 1`,
      [tokenHash, now]
    );
    const row = (rows as Row[])[0];
    return row === undefined ? undefined : Invitation.reconstitute(mapRow(row));
  }

  public async consumeByTokenHash(tokenHash: string, now: Date): Promise<Invitation | undefined> {
    const [updateResult] = await this.connection.execute(
      `UPDATE identity_invitations
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
      `SELECT ${SELECT_COLUMNS} FROM identity_invitations WHERE token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    const row = (rows as Row[])[0];
    return row === undefined ? undefined : Invitation.reconstitute(mapRow(row));
  }
}
