import { describe, it, expect } from "vitest";
import { CreateSessionService } from "../application/CreateSessionService.js";
import type { SessionRepository } from "../domain/session/SessionRepository.js";
import type { Session } from "../domain/session/Session.js";
import type { SessionTokenGenerator } from "../infrastructure/token/SessionTokenGenerator.js";
import { hashSessionToken } from "../infrastructure/token/hashSessionToken.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000095";

class FakeSessionRepository implements SessionRepository {
  public inserted: Session[] = [];

  public async insert(session: Session): Promise<void> {
    this.inserted.push(session);
    session.assignInternalIdFromPersistence(this.inserted.length);
  }

  public async findByTokenHash(): Promise<Session | undefined> {
    return undefined;
  }

  public async findByPublicId(): Promise<Session | undefined> {
    return undefined;
  }
}

class FixedSessionTokenGenerator implements SessionTokenGenerator {
  public constructor(private readonly fixedToken: string) {}

  public generate(): string {
    return this.fixedToken;
  }
}

describe("CreateSessionService", () => {
  it("cria uma Session, insere via repository, retorna sessionPublicId/rawToken/expiresAt", async () => {
    const sessionRepository = new FakeSessionRepository();
    const tokenGenerator = new FixedSessionTokenGenerator("token-fixo-de-teste-deterministico");
    const service = new CreateSessionService(sessionRepository, tokenGenerator, 3600);

    const result = await service.execute({ identityPublicId: IDENTITY_PUBLIC_ID, correlationId: CORRELATION_ID });

    expect(sessionRepository.inserted).toHaveLength(1);
    expect(result.sessionPublicId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.rawToken).toBe("token-fixo-de-teste-deterministico");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("token gerado tem 256 bits (32 bytes); duas chamadas produzem tokens diferentes", async () => {
    const sessionRepository = new FakeSessionRepository();
    const tokenGenerator = new (class implements SessionTokenGenerator {
      private counter = 0;
      public generate(): string {
        this.counter += 1;
        return `token-numero-${this.counter}`;
      }
    })();
    const service = new CreateSessionService(sessionRepository, tokenGenerator, 3600);

    const first = await service.execute({ identityPublicId: IDENTITY_PUBLIC_ID, correlationId: CORRELATION_ID });
    const second = await service.execute({ identityPublicId: IDENTITY_PUBLIC_ID, correlationId: CORRELATION_ID });

    expect(first.rawToken).not.toBe(second.rawToken);
  });

  it("rawToken != tokenHash - o hash persistido e SHA-256 do token, nunca o token em si", async () => {
    const sessionRepository = new FakeSessionRepository();
    const rawToken = "token-bruto-de-exemplo-123456";
    const tokenGenerator = new FixedSessionTokenGenerator(rawToken);
    const service = new CreateSessionService(sessionRepository, tokenGenerator, 3600);

    const result = await service.execute({ identityPublicId: IDENTITY_PUBLIC_ID, correlationId: CORRELATION_ID });

    const insertedSession = sessionRepository.inserted[0];
    expect(insertedSession?.getTokenHash()).toBe(hashSessionToken(rawToken));
    expect(insertedSession?.getTokenHash()).not.toBe(rawToken);
    expect(result.rawToken).toBe(rawToken);
  });

  it("o token bruto NUNCA e persistido - apenas o hash esta no objeto Session inserido", async () => {
    const sessionRepository = new FakeSessionRepository();
    const rawToken = "token-que-nunca-deve-aparecer-persistido";
    const tokenGenerator = new FixedSessionTokenGenerator(rawToken);
    const service = new CreateSessionService(sessionRepository, tokenGenerator, 3600);

    await service.execute({ identityPublicId: IDENTITY_PUBLIC_ID, correlationId: CORRELATION_ID });

    const insertedSession = sessionRepository.inserted[0];
    const serialized = JSON.stringify({
      publicId: insertedSession?.getPublicId().toString(),
      tokenHash: insertedSession?.getTokenHash(),
      status: insertedSession?.getStatus()
    });
    expect(serialized).not.toContain(rawToken);
  });

  it("expoe os domainEvents (session.created) para a orquestracao persistir como AuditEvent", async () => {
    const sessionRepository = new FakeSessionRepository();
    const tokenGenerator = new FixedSessionTokenGenerator("token-para-evento");
    const service = new CreateSessionService(sessionRepository, tokenGenerator, 3600);

    const result = await service.execute({ identityPublicId: IDENTITY_PUBLIC_ID, correlationId: CORRELATION_ID });

    expect(result.domainEvents).toHaveLength(1);
    expect(result.domainEvents[0]?.eventType).toBe("session.created");
    expect(result.domainEvents[0]?.actorPublicId).toBe(IDENTITY_PUBLIC_ID);
  });

  it("nunca recebe email/password - so identityPublicId", async () => {
    const sessionRepository = new FakeSessionRepository();
    const tokenGenerator = new FixedSessionTokenGenerator("token-x");
    const service = new CreateSessionService(sessionRepository, tokenGenerator, 3600);

    const result = await service.execute({ identityPublicId: IDENTITY_PUBLIC_ID, correlationId: CORRELATION_ID });
    expect(result.sessionPublicId).toBeDefined();
  });
});
