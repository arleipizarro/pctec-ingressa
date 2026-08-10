import { describe, it, expect } from "vitest";
import { ValidateSessionService } from "../application/ValidateSessionService.js";
import { SessionValidationFailedError } from "../domain/errors/SessionValidationErrors.js";
import { Session } from "../domain/session/Session.js";
import { Identity } from "../../identity/domain/Identity.js";
import { hashSessionToken } from "../infrastructure/token/hashSessionToken.js";
import { FakeSessionValidationRepository } from "./FakeSessionValidationRepository.js";
import { FakeAuthIdentityRepository } from "./FakeAuthRepositories.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const RAW_TOKEN = "token-bruto-de-teste-para-validacao-de-sessao";
const TOKEN_HASH = hashSessionToken(RAW_TOKEN);
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000200";

function buildActiveIdentity(overrides: { status?: string; loginEnabled?: boolean } = {}): Identity {
  return Identity.reconstitute({
    internalId: 1,
    publicId: IDENTITY_PUBLIC_ID,
    type: "HUMAN",
    fullName: "Pessoa de Teste",
    email: "pessoa@example.com",
    emailNormalized: "pessoa@example.com",
    status: overrides.status ?? "ACTIVE",
    loginEnabled: overrides.loginEnabled ?? true,
    version: 3,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  });
}

function buildActiveSession(): Session {
  const session = Session.create({
    identityPublicId: IDENTITY_PUBLIC_ID,
    tokenHash: TOKEN_HASH,
    ttlSeconds: 3600,
    correlationId: CORRELATION_ID
  });
  session.pullDomainEvents();
  return session;
}

function buildExpiredSession(): Session {
  return Session.reconstitute({
    internalId: 1,
    publicId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    identityPublicId: IDENTITY_PUBLIC_ID,
    tokenHash: TOKEN_HASH,
    status: "ACTIVE",
    createdAt: new Date("2000-01-01T00:00:00Z"),
    expiresAt: new Date("2000-01-01T01:00:00Z"),
    version: 1
  });
}

function createHarness() {
  const sessionRepository = new FakeSessionValidationRepository();
  const identityRepository = new FakeAuthIdentityRepository();
  const service = new ValidateSessionService(sessionRepository, identityRepository);
  return { sessionRepository, identityRepository, service };
}

describe("ValidateSessionService - 4-9. cada causa de falha -> SessionValidationFailedError (SESSION_INVALID, 401)", () => {
  it("4. token desconhecido -> SESSION_NOT_FOUND (interno), SESSION_INVALID (externo)", async () => {
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SessionValidationFailedError);
    expect((caught as SessionValidationFailedError).code).toBe("SESSION_INVALID");
    expect((caught as SessionValidationFailedError).reason).toBe("SESSION_NOT_FOUND");
  });

  it("5. Session REVOKED -> SESSION_REVOKED (interno)", async () => {
    const { sessionRepository, service } = createHarness();
    const session = buildActiveSession();
    session.revoke({ reason: "LOGOUT", actorPublicId: IDENTITY_PUBLIC_ID, correlationId: CORRELATION_ID });
    sessionRepository.byTokenHash.set(TOKEN_HASH, session);

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    expect((caught as SessionValidationFailedError).reason).toBe("SESSION_REVOKED");
  });

  it("6. Session expirada -> SESSION_EXPIRED (interno)", async () => {
    const { sessionRepository, service } = createHarness();
    sessionRepository.byTokenHash.set(TOKEN_HASH, buildExpiredSession());

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    expect((caught as SessionValidationFailedError).reason).toBe("SESSION_EXPIRED");
  });

  it("7. Identity inexistente -> IDENTITY_NOT_FOUND (interno)", async () => {
    const { sessionRepository, service } = createHarness();
    sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    expect((caught as SessionValidationFailedError).reason).toBe("IDENTITY_NOT_FOUND");
  });

  it("7. [REVISÃO CRÍTICA, item 7] Identity não ACTIVE + Session ACTIVE e não expirada -> SESSION_INVALID/401 (AUTHENTICATION), NUNCA 403 (AUTHORIZATION)", async () => {
    const { sessionRepository, identityRepository, service } = createHarness();
    const session = buildActiveSession();
    expect(session.isValid()).toBe(true); // confirma explicitamente: a Session em si é válida
    sessionRepository.byTokenHash.set(TOKEN_HASH, session);
    identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity({ status: "BLOCKED" }));

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    const error = caught as SessionValidationFailedError;
    expect(error.reason).toBe("IDENTITY_NOT_ACTIVE");
    expect(error.code).toBe("SESSION_INVALID");
    expect(error.classification).toBe("AUTHENTICATION"); // 401 — nunca "AUTHORIZATION" (403)
    expect(error.classification).not.toBe("AUTHORIZATION");
  });

  it("8. Identity não ACTIVE -> IDENTITY_NOT_ACTIVE (interno) — mesmo com Session válida", async () => {
    const { sessionRepository, identityRepository, service } = createHarness();
    sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());
    identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity({ status: "BLOCKED" }));

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    expect((caught as SessionValidationFailedError).reason).toBe("IDENTITY_NOT_ACTIVE");
  });

  it("9. loginEnabled=false + Session ACTIVE e não expirada -> SESSION_INVALID/401, NUNCA 403", async () => {
    const { sessionRepository, identityRepository, service } = createHarness();
    const session = buildActiveSession();
    expect(session.isValid()).toBe(true);
    sessionRepository.byTokenHash.set(TOKEN_HASH, session);
    identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity({ loginEnabled: false }));

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    const error = caught as SessionValidationFailedError;
    expect(error.reason).toBe("LOGIN_NOT_ENABLED");
    expect(error.code).toBe("SESSION_INVALID");
    expect(error.classification).toBe("AUTHENTICATION");
    expect(error.classification).not.toBe("AUTHORIZATION");
  });

  it("9. loginEnabled=false -> LOGIN_NOT_ENABLED (interno) — mesmo com Session válida e Identity ACTIVE", async () => {
    const { sessionRepository, identityRepository, service } = createHarness();
    sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());
    identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity({ loginEnabled: false }));

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    expect((caught as SessionValidationFailedError).reason).toBe("LOGIN_NOT_ENABLED");
  });

  it("todos os 6 cenários (4-9) produzem a MESMA estrutura externa (code/classification/mensagem idênticos)", async () => {
    const scenarios: Array<() => Promise<void>> = [
      async () => {
        const { service } = createHarness();
        await service.execute({ rawSessionToken: RAW_TOKEN });
      },
      async () => {
        const { sessionRepository, service } = createHarness();
        const s = buildActiveSession();
        s.revoke({ reason: "LOGOUT", actorPublicId: IDENTITY_PUBLIC_ID, correlationId: CORRELATION_ID });
        sessionRepository.byTokenHash.set(TOKEN_HASH, s);
        await service.execute({ rawSessionToken: RAW_TOKEN });
      },
      async () => {
        const { sessionRepository, service } = createHarness();
        sessionRepository.byTokenHash.set(TOKEN_HASH, buildExpiredSession());
        await service.execute({ rawSessionToken: RAW_TOKEN });
      },
      async () => {
        const { sessionRepository, service } = createHarness();
        sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());
        await service.execute({ rawSessionToken: RAW_TOKEN });
      },
      async () => {
        const { sessionRepository, identityRepository, service } = createHarness();
        sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());
        identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity({ status: "INACTIVE" }));
        await service.execute({ rawSessionToken: RAW_TOKEN });
      },
      async () => {
        const { sessionRepository, identityRepository, service } = createHarness();
        sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());
        identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity({ loginEnabled: false }));
        await service.execute({ rawSessionToken: RAW_TOKEN });
      }
    ];

    const errors: SessionValidationFailedError[] = [];
    for (const scenario of scenarios) {
      try {
        await scenario();
        throw new Error("deveria ter lancado SessionValidationFailedError");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionValidationFailedError);
        errors.push(error as SessionValidationFailedError);
      }
    }

    const codes = new Set(errors.map((e) => e.code));
    const classifications = new Set(errors.map((e) => e.classification));
    const messages = new Set(errors.map((e) => e.message));
    expect(codes.size).toBe(1);
    expect(classifications.size).toBe(1);
    expect(messages.size).toBe(1);
    expect([...codes][0]).toBe("SESSION_INVALID");
    expect([...classifications][0]).toBe("AUTHENTICATION");

    const reasons = new Set(errors.map((e) => e.reason));
    expect(reasons.size).toBe(6);
  });
});

describe("ValidateSessionService - 10. sucesso -> AuthenticatedPrincipal correto", () => {
  it("Session válida + Identity ACTIVE + loginEnabled=true -> principal correto", async () => {
    const { sessionRepository, identityRepository, service } = createHarness();
    const session = buildActiveSession();
    sessionRepository.byTokenHash.set(TOKEN_HASH, session);
    identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity());

    const principal = await service.execute({ rawSessionToken: RAW_TOKEN });

    expect(principal.identityPublicId).toBe(IDENTITY_PUBLIC_ID);
    expect(principal.sessionPublicId).toBe(session.getPublicId().toString());
  });

  it("14/15. o principal nunca contém ADMIN/roles/permissions/applicationAccesses", async () => {
    const { sessionRepository, identityRepository, service } = createHarness();
    sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());
    identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity());

    const principal = await service.execute({ rawSessionToken: RAW_TOKEN });

    expect(Object.keys(principal).sort()).toEqual(["identityPublicId", "sessionPublicId"].sort());
    expect(principal).not.toHaveProperty("admin");
    expect(principal).not.toHaveProperty("roles");
    expect(principal).not.toHaveProperty("permissions");
    expect(principal).not.toHaveProperty("applicationAccesses");
  });
});

describe("ValidateSessionService - 11/12/13. token bruto nunca vaza; SHA-256 usado no lookup", () => {
  it("12. o repository é consultado com o HASH (SHA-256), nunca o token bruto", async () => {
    const { sessionRepository, identityRepository, service } = createHarness();
    sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());
    identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity());

    await service.execute({ rawSessionToken: RAW_TOKEN });

    expect(sessionRepository.findByTokenHashCalls).toEqual([TOKEN_HASH]);
  });

  it("13. o token bruto NUNCA é passado ao repository — apenas seu hash", async () => {
    const { sessionRepository, identityRepository, service } = createHarness();
    sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());
    identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity());

    await service.execute({ rawSessionToken: RAW_TOKEN });

    expect(sessionRepository.findByTokenHashCalls).not.toContain(RAW_TOKEN);
  });

  it("11. o token bruto nunca aparece na mensagem de nenhum erro lançado", async () => {
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: RAW_TOKEN });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).not.toContain(RAW_TOKEN);
  });

  it("token vazio -> COOKIE_MALFORMED (interno), sem sequer consultar o repository", async () => {
    const { sessionRepository, service } = createHarness();

    await expect(service.execute({ rawSessionToken: "" })).rejects.toThrow(SessionValidationFailedError);

    expect(sessionRepository.findByTokenHashCalls).toHaveLength(0);
  });

  it("token só com espaços -> COOKIE_MALFORMED (interno)", async () => {
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.execute({ rawSessionToken: "   " });
    } catch (error) {
      caught = error;
    }

    expect((caught as SessionValidationFailedError).reason).toBe("COOKIE_MALFORMED");
  });
});

describe("ValidateSessionService - nunca resolve ApplicationAccess", () => {
  it("o resultado não tem nenhum vestígio de ApplicationAccess", async () => {
    const { sessionRepository, identityRepository, service } = createHarness();
    sessionRepository.byTokenHash.set(TOKEN_HASH, buildActiveSession());
    identityRepository.byPublicId.set(IDENTITY_PUBLIC_ID, buildActiveIdentity());

    const principal = await service.execute({ rawSessionToken: RAW_TOKEN });

    expect(JSON.stringify(principal)).not.toContain("Access");
    expect(JSON.stringify(principal)).not.toContain("PCTEC_INGRESSA");
  });
});
