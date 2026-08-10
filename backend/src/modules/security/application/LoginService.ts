import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type {
  BootstrapConnection,
  BootstrapConnectionPool
} from "../../identity/application/BootstrapFirstIdentityService.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { CredentialRepository } from "../domain/CredentialRepository.js";
import type { SessionRepository } from "../domain/session/SessionRepository.js";
import { AuthenticateIdentityService, type PasswordVerifier } from "./AuthenticateIdentityService.js";
import { CreateSessionService } from "./CreateSessionService.js";
import type { SessionTokenGenerator } from "../infrastructure/token/SessionTokenGenerator.js";

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
  readonly correlationId?: string | undefined;
}

export interface LoginResult {
  readonly identityPublicId: string;
  readonly sessionPublicId: string;
  readonly rawToken: string;
  readonly expiresAt: Date;
}

/**
 * Orquestra `POST /api/v1/sessions` — v0.6.0, Fase D (ADR-030).
 *
 * `AuthenticateIdentityService` e `CreateSessionService` permanecem
 * classes separadas, focadas, cada uma testável isoladamente (ADR-030,
 * nunca fundidas) — `LoginService` é a camada que os invoca dentro da
 * MESMA transação/conexão física, mesmo padrão estrutural já usado pelos
 * três `BootstrapFirst*Service` (repository FACTORIES vinculadas a uma
 * conexão compartilhada, nunca instâncias pré-construídas).
 *
 * **Sem named lock** — diferente dos bootstraps (operações one-shot),
 * login é uma operação ordinária, concorrente por natureza (múltiplas
 * pessoas logando ao mesmo tempo é o caso normal, não uma exceção a
 * serializar). Concorrência real é protegida pelo optimistic locking já
 * existente em `Credential.update()` (`WHERE version = ?`), não por um
 * lock de aplicação.
 *
 * Timeline (sucesso): `pool.getConnection()` → `BEGIN` →
 * `AuthenticateIdentityService.execute()` (SELECT Identity, SELECT
 * Credential, verify — real ou dummy, UPDATE Credential se sucesso) →
 * `CreateSessionService.execute()` (INSERT Session) → `INSERT
 * AuditEvent` (`session.created`) → `COMMIT` → `connection.release()`.
 *
 * Em qualquer erro (incluindo `AuthenticationFailedError` — falha de
 * login É um caminho de erro desta transação, não um caso especial):
 * `ROLLBACK` → `connection.release()`. `release()` sempre no `finally`
 * mais externo.
 */
export class LoginService {
  public constructor(
    private readonly pool: BootstrapConnectionPool,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly credentialRepositoryFactory: (connection: Queryable) => CredentialRepository,
    private readonly sessionRepositoryFactory: (connection: Queryable) => SessionRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly tokenGenerator: SessionTokenGenerator,
    private readonly sessionTtlSeconds: number
  ) {}

  public async execute(request: LoginRequest): Promise<LoginResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const connection = await this.pool.getConnection();

    try {
      return await this.runInTransaction(connection, request, correlationId);
    } finally {
      connection.release();
    }
  }

  private async runInTransaction(
    connection: BootstrapConnection,
    request: LoginRequest,
    correlationId: string
  ): Promise<LoginResult> {
    const identityRepository = this.identityRepositoryFactory(connection);
    const credentialRepository = this.credentialRepositoryFactory(connection);
    const sessionRepository = this.sessionRepositoryFactory(connection);
    const auditEventRepository = this.auditEventRepositoryFactory(connection);

    await connection.beginTransaction();
    try {
      const authenticateService = new AuthenticateIdentityService(
        identityRepository,
        credentialRepository,
        this.passwordVerifier
      );
      const authenticated = await authenticateService.execute({
        email: request.email,
        password: request.password
      });

      const createSessionService = new CreateSessionService(
        sessionRepository,
        this.tokenGenerator,
        this.sessionTtlSeconds
      );
      const createdSession = await createSessionService.execute({
        identityPublicId: authenticated.identityPublicId,
        correlationId
      });

      if (createdSession.domainEvents.length > 0) {
        const auditEvents = createdSession.domainEvents.map((event) => AuditEvent.fromDomainEvent(event));
        await auditEventRepository.insertMany(auditEvents);
      }

      await connection.commit();

      return {
        identityPublicId: authenticated.identityPublicId,
        sessionPublicId: createdSession.sessionPublicId,
        rawToken: createdSession.rawToken,
        expiresAt: createdSession.expiresAt
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
}
