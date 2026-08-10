import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type {
  BootstrapConnection,
  BootstrapConnectionPool
} from "../../identity/application/BootstrapFirstIdentityService.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { SessionRepository } from "../domain/session/SessionRepository.js";
import { hashSessionToken } from "../infrastructure/token/hashSessionToken.js";
import { SessionValidationFailedError } from "../domain/errors/SessionValidationErrors.js";

export interface LogoutRequest {
  readonly rawSessionToken: string;
  readonly correlationId?: string | undefined;
}

/**
 * Orquestra `DELETE /api/v1/sessions/current` (logout) — v0.6.x, Fase E
 * (ADR-030, "Logout").
 *
 * **Por que não reutiliza `ValidateSessionService` diretamente:**
 * `ValidateSessionService` retorna apenas `AuthenticatedPrincipal`
 * (`identityPublicId`/`sessionPublicId`) — deliberadamente minimalista,
 * para o caso de uso de autenticação (middleware). O logout precisa da
 * instância `Session` completa (com sua `version` atual) para chamar
 * `session.revoke()` e persistir via `SessionRepository.update()` com
 * optimistic locking — por isso reimplementa aqui os mesmos passos de
 * validação (SELECT_SESSION → checar revoked/expired → SELECT_IDENTITY
 * → checar status/loginEnabled), na MESMA conexão/transação usada para
 * a revogação, em vez de invocar um serviço separado que abriria sua
 * própria consulta redundante. Não é duplicação de MECANISMO (nenhum
 * novo conceito de validação é inventado) — é a mesma lógica, reaplicada
 * dentro do escopo transacional que a revogação exige.
 *
 * **Sem named lock** — mesma justificativa de `LoginService`: logout é
 * uma operação ordinária por natureza, protegida por optimistic locking
 * (`SessionRepository.update()`), não por lock de aplicação.
 *
 * Timeline (sucesso): `pool.getConnection()` → `BEGIN` →
 * `SELECT_SESSION` → `SELECT_IDENTITY` → `UPDATE_SESSION` → `INSERT
 * AuditEvent` (`session.revoked`) → `COMMIT` → `connection.release()`.
 * Em qualquer erro: `ROLLBACK` → `connection.release()`.
 */
export class LogoutService {
  public constructor(
    private readonly pool: BootstrapConnectionPool,
    private readonly sessionRepositoryFactory: (connection: Queryable) => SessionRepository,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: LogoutRequest): Promise<void> {
    const correlationId = request.correlationId ?? randomUUID();
    const connection = await this.pool.getConnection();

    try {
      await this.runInTransaction(connection, request.rawSessionToken, correlationId);
    } finally {
      connection.release();
    }
  }

  private async runInTransaction(
    connection: BootstrapConnection,
    rawSessionToken: string,
    correlationId: string
  ): Promise<void> {
    const sessionRepository = this.sessionRepositoryFactory(connection);
    const identityRepository = this.identityRepositoryFactory(connection);
    const auditEventRepository = this.auditEventRepositoryFactory(connection);

    await connection.beginTransaction();
    try {
      if (rawSessionToken.trim().length === 0) {
        throw new SessionValidationFailedError("COOKIE_MALFORMED");
      }

      const tokenHash = hashSessionToken(rawSessionToken);
      const session = await sessionRepository.findByTokenHash(tokenHash);
      if (session === undefined) {
        throw new SessionValidationFailedError("SESSION_NOT_FOUND");
      }
      if (session.isRevoked()) {
        throw new SessionValidationFailedError("SESSION_REVOKED");
      }
      if (session.isExpired()) {
        throw new SessionValidationFailedError("SESSION_EXPIRED");
      }

      const identity = await identityRepository.findByPublicId(
        PublicId.fromString(session.getIdentityPublicId())
      );
      if (identity === undefined) {
        throw new SessionValidationFailedError("IDENTITY_NOT_FOUND");
      }
      if (identity.getStatus().toString() !== "ACTIVE") {
        throw new SessionValidationFailedError("IDENTITY_NOT_ACTIVE");
      }
      if (!identity.isLoginEnabled()) {
        throw new SessionValidationFailedError("LOGIN_NOT_ENABLED");
      }

      const expectedVersion = session.getVersion();
      session.revoke({
        reason: "LOGOUT",
        actorPublicId: identity.getPublicId().toString(),
        correlationId
      });
      await sessionRepository.update(session, expectedVersion);

      const events = session.pullDomainEvents();
      if (events.length > 0) {
        const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
        await auditEventRepository.insertMany(auditEvents);
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
}
