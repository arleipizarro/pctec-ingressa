import type { SessionRepository } from "../domain/session/SessionRepository.js";
import { Session } from "../domain/session/Session.js";
import type { SessionCreatedEvent } from "../domain/session/SessionDomainEvents.js";
import type { SessionTokenGenerator } from "../infrastructure/token/SessionTokenGenerator.js";
import { hashSessionToken } from "../infrastructure/token/hashSessionToken.js";

export interface CreateSessionRequest {
  readonly identityPublicId: string;
  readonly correlationId: string;
  readonly causationId?: string | undefined;
}

export interface CreatedSession {
  readonly sessionPublicId: string;
  /**
   * Token bruto — existe EXCLUSIVAMENTE neste valor de retorno, em
   * memória. Nunca persistido (só seu hash, via `Session`/
   * `SessionRepository`), nunca logado, nunca incluído em nenhum
   * `AuditEvent`.
   */
  readonly rawToken: string;
  readonly expiresAt: Date;
  /**
   * Eventos de domínio pulados de `Session` (`session.created`) — expostos
   * para que a camada orquestradora (`LoginService`) possa persisti-los
   * como `AuditEvent` na mesma transação. `CreateSessionService` não
   * persiste eventos diretamente — mesma separação de responsabilidade já
   * praticada pelos serviços de bootstrap (o Aggregate produz eventos, o
   * orquestrador decide onde/como persistir).
   */
  readonly domainEvents: readonly SessionCreatedEvent[];
}

/**
 * Cria uma `Session` nova — v0.6.0, Fase D (ADR-030,
 * `CreateSessionService`).
 *
 * Separado de `AuthenticateIdentityService` deliberadamente (nunca
 * fundidos em um só serviço) — mesma separação de responsabilidade única
 * já praticada em toda a base. Recebe apenas `identityPublicId`, já
 * provado por `AuthenticateIdentityService` — nunca `email`/`password`.
 *
 * **Nunca consulta `ApplicationAccess`** — mesmo boundary já fixado.
 */
export class CreateSessionService {
  public constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly tokenGenerator: SessionTokenGenerator,
    private readonly ttlSeconds: number
  ) {}

  public async execute(request: CreateSessionRequest): Promise<CreatedSession> {
    const rawToken = this.tokenGenerator.generate();
    const tokenHash = hashSessionToken(rawToken);

    const session = Session.create({
      identityPublicId: request.identityPublicId,
      tokenHash,
      ttlSeconds: this.ttlSeconds,
      correlationId: request.correlationId,
      causationId: request.causationId
    });

    await this.sessionRepository.insert(session);

    const domainEvents = session.pullDomainEvents();

    return {
      sessionPublicId: session.getPublicId().toString(),
      rawToken,
      expiresAt: session.getExpiresAt(),
      domainEvents
    };
  }
}
