import { describe, it, expect } from "vitest";
import {
  ApplicationAccess,
  APPLICATION_ACCESS_BOOTSTRAP_EVENT_ACTOR_MARKER
} from "../domain/ApplicationAccess.js";
import { AccessProfile, ApplicationAccessInvalidProfileError } from "../domain/value-objects/AccessProfile.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const APPLICATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000050";

describe("ApplicationAccess.grantFoundationalAdminAccess", () => {
  it("cria a concessão com status GRANTED, accessProfile ADMIN e version=1", () => {
    const applicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationPublicId: APPLICATION_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(applicationAccess.getStatus()).toBe("GRANTED");
    expect(applicationAccess.isGranted()).toBe(true);
    expect(applicationAccess.getAccessProfile().toString()).toBe("ADMIN");
    expect(applicationAccess.getVersion()).toBe(1);
    expect(applicationAccess.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
    expect(applicationAccess.getApplicationPublicId()).toBe(APPLICATION_PUBLIC_ID);
  });

  it("18. grantedByIdentityPublicId é undefined (⇒ NULL na persistência) — nunca um marcador fingindo ser um public_id", () => {
    const applicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationPublicId: APPLICATION_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(applicationAccess.getGrantedByIdentityPublicId()).toBeUndefined();
  });

  it("19/20. o evento gerado é application-access.granted com actorPublicId = BOOTSTRAP", () => {
    const applicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationPublicId: APPLICATION_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const [event] = applicationAccess.pullDomainEvents();

    expect(event?.eventType).toBe("application-access.granted");
    expect(event?.actorPublicId).toBe("BOOTSTRAP");
    expect(event?.actorPublicId).toBe(APPLICATION_ACCESS_BOOTSTRAP_EVENT_ACTOR_MARKER);
    expect(event?.aggregatePublicId).toBe(applicationAccess.getPublicId().toString());
  });

  it("o payload do evento não contém nenhum dado sensível — apenas public_ids e o perfil", () => {
    const applicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationPublicId: APPLICATION_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const [event] = applicationAccess.pullDomainEvents();

    expect(Object.keys(event?.payload ?? {}).sort()).toEqual(
      ["accessProfile", "applicationAccessPublicId", "applicationPublicId", "identityPublicId"].sort()
    );
  });

  it("pullDomainEvents limpa os eventos após a leitura", () => {
    const applicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationPublicId: APPLICATION_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(applicationAccess.pullDomainEvents()).toHaveLength(1);
    expect(applicationAccess.pullDomainEvents()).toHaveLength(0);
  });

  it("internalId nunca é exposto por getter público comum — só pelo método de infraestrutura", () => {
    const applicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationPublicId: APPLICATION_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(applicationAccess.getInternalIdForPersistence()).toBeUndefined();
    applicationAccess.assignInternalIdFromPersistence(7);
    expect(applicationAccess.getInternalIdForPersistence()).toBe(7);
  });
});

describe("ApplicationAccess.reconstitute", () => {
  it("reconstrói a partir de estado persistido, sem gerar eventos", () => {
    const applicationAccess = ApplicationAccess.reconstitute({
      internalId: 5,
      publicId: "22222222-2222-2222-2222-222222222222",
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationPublicId: APPLICATION_PUBLIC_ID,
      accessProfile: "ADMIN",
      status: "GRANTED",
      grantedAt: new Date("2026-01-01T00:00:00Z"),
      grantedByIdentityPublicId: undefined,
      revokedAt: undefined,
      revokedByIdentityPublicId: undefined,
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z")
    });

    expect(applicationAccess.getStatus()).toBe("GRANTED");
    expect(applicationAccess.pullDomainEvents()).toHaveLength(0);
  });
});

describe("AccessProfile — 5/6. perfil válido/inválido", () => {
  it("ADMIN é válido", () => {
    expect(() => AccessProfile.create("ADMIN")).not.toThrow();
    expect(AccessProfile.admin().toString()).toBe("ADMIN");
  });

  it("qualquer outro valor é rejeitado com APPLICATION_ACCESS_INVALID_PROFILE", () => {
    expect(() => AccessProfile.create("USER")).toThrow(ApplicationAccessInvalidProfileError);
    expect(() => AccessProfile.create("SUPERADMIN")).toThrow(ApplicationAccessInvalidProfileError);
    expect(() => AccessProfile.create("")).toThrow(ApplicationAccessInvalidProfileError);
  });

  it("o código de erro é exatamente APPLICATION_ACCESS_INVALID_PROFILE", () => {
    try {
      AccessProfile.create("INVALID");
      expect.unreachable();
    } catch (error) {
      expect((error as ApplicationAccessInvalidProfileError).code).toBe("APPLICATION_ACCESS_INVALID_PROFILE");
    }
  });
});
