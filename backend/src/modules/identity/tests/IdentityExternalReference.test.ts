import { describe, it, expect } from "vitest";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import { InvalidSystemCodeError } from "../domain/value-objects/SystemCode.js";
import { InvalidEntityTypeError } from "../domain/value-objects/EntityType.js";
import { InvalidLegacyIdError } from "../domain/value-objects/LegacyId.js";
import { InvalidMatchMethodError } from "../domain/value-objects/MatchMethod.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ACTOR_PUBLIC_ID = "8f14e45f-ceea-467e-a1a3-000000000001";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000002";

function createReference(overrides?: {
  systemCode?: string;
  entityType?: string;
  legacyId?: string | number;
  matchMethod?: string;
}) {
  return IdentityExternalReference.create({
    identityPublicId: IDENTITY_PUBLIC_ID,
    systemCode: overrides?.systemCode ?? "PCTEC_PORTAL",
    entityType: overrides?.entityType ?? "portal_acesso",
    legacyId: overrides?.legacyId ?? 33,
    matchMethod: overrides?.matchMethod ?? "MATCHED_MANUAL_CONFIRMED",
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
}

describe("IdentityExternalReference — 1. cria referência Portal", () => {
  it("cria com systemCode=PCTEC_PORTAL, status ACTIVE, publicId próprio", () => {
    const reference = createReference({ systemCode: "PCTEC_PORTAL", entityType: "portal_acesso", legacyId: 33 });

    expect(reference.getSystemCode().toString()).toBe("PCTEC_PORTAL");
    expect(reference.getEntityType().toString()).toBe("portal_acesso");
    expect(reference.getLegacyId().toString()).toBe("33");
    expect(reference.getStatus()).toBe("ACTIVE");
    expect(reference.isActive()).toBe(true);
    expect(reference.getPublicId().toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // publicId próprio, distinto do identityPublicId referenciado.
    expect(reference.getPublicId().toString()).not.toBe(IDENTITY_PUBLIC_ID);
  });
});

describe("IdentityExternalReference — 2. cria referência HUB", () => {
  it("cria com systemCode=PCTEC_HUB", () => {
    const reference = createReference({ systemCode: "PCTEC_HUB", entityType: "clientes", legacyId: 7 });
    expect(reference.getSystemCode().toString()).toBe("PCTEC_HUB");
  });
});

describe("IdentityExternalReference — 3. cria referência Helpdesk", () => {
  it("cria com systemCode=PCTEC_HELPDESK", () => {
    const reference = createReference({ systemCode: "PCTEC_HELPDESK", entityType: "clients", legacyId: 99 });
    expect(reference.getSystemCode().toString()).toBe("PCTEC_HELPDESK");
  });

  it("rejeita systemCode fora do conjunto fechado (nenhum sistema fictício aceito)", () => {
    expect(() => createReference({ systemCode: "PCTEC_FANTASIA" })).toThrow(InvalidSystemCodeError);
  });
});

describe("IdentityExternalReference — 4. mesmo legacyId em sistemas diferentes permitido (construção)", () => {
  it("duas referências com o MESMO legacyId, mas systemCode diferente, são construídas sem erro (unicidade é responsabilidade do repository/constraint, não do Aggregate)", () => {
    const hubReference = createReference({ systemCode: "PCTEC_HUB", legacyId: 555 });
    const portalReference = createReference({ systemCode: "PCTEC_PORTAL", legacyId: 555 });

    expect(hubReference.getLegacyId().toString()).toBe(portalReference.getLegacyId().toString());
    expect(hubReference.getSystemCode().equals(portalReference.getSystemCode())).toBe(false);
    expect(hubReference.getPublicId().equals(portalReference.getPublicId())).toBe(false);
  });
});

describe("IdentityExternalReference — 5. entityType", () => {
  it("aceita qualquer entityType não vazio, até 64 caracteres (VARCHAR aberto, não ENUM)", () => {
    const reference = createReference({ entityType: "portal_acesso" });
    expect(reference.getEntityType().toString()).toBe("portal_acesso");
  });

  it("rejeita entityType vazio", () => {
    expect(() => createReference({ entityType: "" })).toThrow(InvalidEntityTypeError);
  });
});

describe("IdentityExternalReference — 6. legacyId", () => {
  it("aceita legacyId numérico e normaliza para string canônica", () => {
    const reference = createReference({ legacyId: 33 });
    expect(reference.getLegacyId().toString()).toBe("33");
    expect(reference.getLegacyId().toNumber()).toBe(33);
  });

  it("aceita legacyId como string numérica", () => {
    const reference = createReference({ legacyId: "789" });
    expect(reference.getLegacyId().toString()).toBe("789");
  });

  it("rejeita legacyId zero, negativo ou não numérico", () => {
    expect(() => createReference({ legacyId: 0 })).toThrow(InvalidLegacyIdError);
    expect(() => createReference({ legacyId: -1 })).toThrow(InvalidLegacyIdError);
    expect(() => createReference({ legacyId: "abc" })).toThrow(InvalidLegacyIdError);
  });
});

describe("IdentityExternalReference — 7. publicId próprio", () => {
  it("duas referências distintas nunca colidem em publicId", () => {
    const a = createReference({ legacyId: 1 });
    const b = createReference({ legacyId: 2 });
    expect(a.getPublicId().equals(b.getPublicId())).toBe(false);
  });
});

describe("IdentityExternalReference — 8. reconstituição", () => {
  it("reconstrói a partir de estado persistido, incluindo status SUPERSEDED", () => {
    const reference = IdentityExternalReference.reconstitute({
      internalId: 3,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000009",
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 33,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      status: "SUPERSEDED",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });

    expect(reference.getInternalIdForPersistence()).toBe(3);
    expect(reference.getStatus()).toBe("SUPERSEDED");
    expect(reference.isActive()).toBe(false);
    expect(reference.getMatchMethod().toString()).toBe("MATCHED_MANUAL_CONFIRMED");
    expect(reference.pullDomainEvents()).toHaveLength(0);
  });
});

describe("IdentityExternalReference — 9. evento identity-external-reference.created", () => {
  it("create() produz exatamente um evento com matchMethod no payload, sem legacyId", () => {
    const reference = createReference({ systemCode: "PCTEC_PORTAL", entityType: "portal_acesso", legacyId: 33 });

    const events = reference.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("identity-external-reference.created");
    expect(events[0]?.payload).toEqual({
      identityExternalReferencePublicId: reference.getPublicId().toString(),
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      matchMethod: "MATCHED_MANUAL_CONFIRMED"
    });
    // legacyId nunca aparece no payload do evento (não é identificador cross-system).
    expect(JSON.stringify(events[0]?.payload)).not.toContain("\"33\"");
    expect(JSON.stringify(events[0]?.payload)).not.toContain(":33");
  });
});

describe("IdentityExternalReference — 10. não expõe internalId publicamente", () => {
  it("getInternalIdForPersistence é undefined antes de persistir", () => {
    const reference = createReference();
    expect(reference.getInternalIdForPersistence()).toBeUndefined();
    reference.assignInternalIdFromPersistence(21);
    expect(reference.getInternalIdForPersistence()).toBe(21);
  });
});

describe("IdentityExternalReference — 11. matchMethod MATCHED_BY_EMAIL", () => {
  it("cria com matchMethod=MATCHED_BY_EMAIL", () => {
    const reference = createReference({ matchMethod: "MATCHED_BY_EMAIL" });
    expect(reference.getMatchMethod().toString()).toBe("MATCHED_BY_EMAIL");
  });
});

describe("IdentityExternalReference — 12. matchMethod inválido rejeitado", () => {
  it("rejeita matchMethod fora do conjunto fechado (UNMATCHED, AMBIGUOUS, etc. não são persistidos)", () => {
    expect(() => createReference({ matchMethod: "UNMATCHED" })).toThrow(InvalidMatchMethodError);
    expect(() => createReference({ matchMethod: "AMBIGUOUS" })).toThrow(InvalidMatchMethodError);
    expect(() => createReference({ matchMethod: "INVALID_EMAIL" })).toThrow(InvalidMatchMethodError);
    expect(() => createReference({ matchMethod: "" })).toThrow(InvalidMatchMethodError);
  });
});

describe("IdentityExternalReference — 13. matchMethod no evento (diferencial vs Organization)", () => {
  it("MATCHED_BY_EMAIL aparece no payload do evento", () => {
    const reference = createReference({ matchMethod: "MATCHED_BY_EMAIL" });
    const events = reference.pullDomainEvents();
    expect(events[0]?.payload.matchMethod).toBe("MATCHED_BY_EMAIL");
  });

  it("MATCHED_MANUAL_CONFIRMED aparece no payload do evento", () => {
    const reference = createReference({ matchMethod: "MATCHED_MANUAL_CONFIRMED" });
    const events = reference.pullDomainEvents();
    expect(events[0]?.payload.matchMethod).toBe("MATCHED_MANUAL_CONFIRMED");
  });
});

describe("IdentityExternalReference — 14. identityPublicId lido corretamente", () => {
  it("getIdentityPublicId retorna a string passada na criação", () => {
    const reference = createReference();
    expect(reference.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
  });
});

describe("IdentityExternalReference — 15. pullDomainEvents limpa a fila", () => {
  it("chamada dupla de pullDomainEvents retorna lista vazia na segunda vez", () => {
    const reference = createReference();
    const first = reference.pullDomainEvents();
    const second = reference.pullDomainEvents();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });
});
