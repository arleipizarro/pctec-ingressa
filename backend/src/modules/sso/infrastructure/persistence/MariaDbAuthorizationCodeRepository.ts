import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { AuthorizationCodeRepository } from "../../domain/AuthorizationCodeRepository.js";
import { AuthorizationCode, type AuthorizationCodePersistedState } from "../../domain/AuthorizationCode.js";

type Row = Record<string, unknown>;

function readString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de sso_authorization_codes.`);
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
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de sso_authorization_codes.`);
}

function readDate(row: Row, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de sso_authorization_codes.`);
}

function readOptionalDate(row: Row, column: string): Date | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(String(value));
}

function mapRow(row: Row): AuthorizationCodePersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    identityPublicId: readString(row, "identity_public_id"),
    audienceApplicationPublicId: readString(row, "audience_application_public_id"),
    codeHash: readString(row, "code_hash"),
    redirectUri: readString(row, "redirect_uri"),
    codeChallenge: readString(row, "code_challenge"),
    codeChallengeMethod: readString(row, "code_challenge_method"),
    correlationId: readString(row, "correlation_id"),
    createdAt: readDate(row, "created_at"),
    expiresAt: readDate(row, "expires_at"),
    consumedAt: readOptionalDate(row, "consumed_at")
  };
}

const SELECT_COLUMNS = `id, public_id, identity_public_id, audience_application_public_id, code_hash,
       redirect_uri, code_challenge, code_challenge_method, correlation_id,
       created_at, expires_at, consumed_at`;

/**
 * Implementação MariaDB conforme `0022_create_sso_authorization_codes.up.sql`.
 * SQL sempre parametrizado, nunca concatenado com entrada.
 */
export class MariaDbAuthorizationCodeRepository implements AuthorizationCodeRepository {
  public constructor(private readonly connection: Queryable) {}

  public async insert(authorizationCode: AuthorizationCode): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO sso_authorization_codes
         (public_id, identity_public_id, audience_application_public_id, code_hash,
          redirect_uri, code_challenge, code_challenge_method, correlation_id,
          created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        authorizationCode.getPublicId().toString(),
        authorizationCode.getIdentityPublicId(),
        authorizationCode.getAudienceApplicationPublicId(),
        authorizationCode.getCodeHash(),
        authorizationCode.getRedirectUri(),
        authorizationCode.getCodeChallenge(),
        authorizationCode.getCodeChallengeMethod(),
        authorizationCode.getCorrelationId(),
        authorizationCode.getCreatedAt(),
        authorizationCode.getExpiresAt()
      ]
    );
    const insertResult = result as { insertId: number };
    authorizationCode.assignInternalIdFromPersistence(insertResult.insertId);
  }

  /**
   * UPDATE condicional PRIMEIRO, SELECT depois.
   *
   * `affectedRows === 0` cobre de uma vez: código inexistente, já
   * consumido e expirado — e cobre também a corrida, porque só uma das
   * requisições concorrentes consegue a linha com `consumed_at IS NULL`.
   * O SELECT posterior é apenas leitura do que ESTA requisição acabou de
   * ganhar; sem o UPDATE ter passado, ele nunca acontece.
   *
   * O `now` é passado como parâmetro (nunca `NOW()` do servidor) para
   * que a expiração use exatamente o mesmo relógio da aplicação que
   * validou o restante — e para que o teste possa controlá-lo.
   */
  public async consumeByCodeHash(codeHash: string, now: Date): Promise<AuthorizationCode | undefined> {
    const [updateResult] = await this.connection.execute(
      `UPDATE sso_authorization_codes
          SET consumed_at = ?
        WHERE code_hash = ?
          AND consumed_at IS NULL
          AND expires_at > ?`,
      [now, codeHash, now]
    );
    if ((updateResult as { affectedRows: number }).affectedRows === 0) {
      return undefined;
    }

    const [rows] = await this.connection.execute(
      `SELECT ${SELECT_COLUMNS} FROM sso_authorization_codes WHERE code_hash = ? LIMIT 1`,
      [codeHash]
    );
    const row = (rows as Row[])[0];
    return row === undefined ? undefined : AuthorizationCode.reconstitute(mapRow(row));
  }
}
