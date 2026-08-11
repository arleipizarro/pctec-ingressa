import { describe, it, expect } from "vitest";
import { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import { InvalidSystemCodeError } from "../domain/value-objects/SystemCode.js";
import { InvalidEntityTypeError } from "../domain/value-objects/EntityType.js";
import { InvalidLegacyIdError } from "../domain/value-objects/LegacyId.js";

const ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

function createReference(overrides?: { systemCode?: string; entityType?: string; legacyId?: string | number }) {
  return OrganizationExternalReference.create({
    organizationPublicId: ORGANIZATION_PUBLIC_ID,
    systemCode: overrides?.systemCode ?? "PCTEC_HUB",
    entityType: overrides?.entityType ?? "clientes",
    legacyId: overrides?.legacyId ?? 123,
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
}

describe("OrganizationExternalReference — 1. cria referência HUB", () => {
  it("cria com systemCode=PCTEC_HUB, status ACTIVE, publicId próprio", () => {
    const reference = createReference({ systemCode: "PCTEC_HUB", entityType: "clientes_grupo", legacyId: 42 });

    expect(reference.getSystemCode().toString()).toBe("PCTEC_HUB");
    expect(reference.getEntityType().toString()).toBe("clientes_grupo");
    expect(reference.getLegacyId().toString()).toBe("42");
    expect(reference.getStatus()).toBe("ACTIVE");
    expect(reference.isActive()).toBe(true);
    expect(reference.getPublicId().toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // publicId próprio, distinto do organizationPublicId referenciado.
    expect(reference.getPublicId().toString()).not.toBe(ORGANIZATION_PUBLIC_ID);
  });
});

describe("OrganizationExternalReference — 2. cria referência Portal", () => {
  it("cria com systemCode=PCTEC_PORTAL", () => {
    const reference = createReference({ systemCode: "PCTEC_PORTAL", entityType: "clientes", legacyId: 7 });
    expect(reference.getSystemCode().toString()).toBe("PCTEC_PORTAL");
  });
});

describe("OrganizationExternalReference — 3. cria referência Helpdesk", () => {
  it("cria com systemCode=PCTEC_HELPDESK", () => {
    const reference = createReference({ systemCode: "PCTEC_HELPDESK", entityType: "clients", legacyId: 99 });
    expect(reference.getSystemCode().toString()).toBe("PCTEC_HELPDESK");
  });

  it("rejeita systemCode fora do conjunto fechado (nenhum sistema fictício aceito)", () => {
    expect(() => createReference({ systemCode: "PCTEC_FANTASIA" })).toThrow(InvalidSystemCodeError);
  });
});

describe("OrganizationExternalReference — 4. mesmo legacyId em sistemas diferentes permitido (construção)", () => {
  it("duas referências com o MESMO legacyId, mas systemCode diferente, são construídas sem erro (unicidade é responsabilidade do repository/constraint, não do Aggregate)", () => {
    const hubReference = createReference({ systemCode: "PCTEC_HUB", legacyId: 555 });
    const portalReference = createReference({ systemCode: "PCTEC_PORTAL", legacyId: 555 });

    expect(hubReference.getLegacyId().toString()).toBe(portalReference.getLegacyId().toString());
    expect(hubReference.getSystemCode().equals(portalReference.getSystemCode())).toBe(false);
    expect(hubReference.getPublicId().equals(portalReference.getPublicId())).toBe(false);
  });
});

describe("OrganizationExternalReference — 5. entityType", () => {
  it("aceita qualquer entityType não vazio, até 64 caracteres (VARCHAR aberto, não ENUM)", () => {
    const reference = createReference({ entityType: "clientes_grupo_membros" });
    expect(reference.getEntityType().toString()).toBe("clientes_grupo_membros");
  });

  it("rejeita entityType vazio", () => {
    expect(() => createReference({ entityType: "" })).toThrow(InvalidEntityTypeError);
  });
});

describe("OrganizationExternalReference — 6. legacyId", () => {
  it("aceita legacyId numérico e normaliza para string canônica", () => {
    const reference = createReference({ legacyId: 42 });
    expect(reference.getLegacyId().toString()).toBe("42");
    expect(reference.getLegacyId().toNumber()).toBe(42);
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

describe("OrganizationExternalReference — 7. publicId próprio", () => {
  it("duas referências distintas nunca colidem em publicId", () => {
    const a = createReference({ legacyId: 1 });
    const b = createReference({ legacyId: 2 });
    expect(a.getPublicId().equals(b.getPublicId())).toBe(false);
  });
});

describe("OrganizationExternalReference — 8. reconstituição", () => {
  it("reconstrói a partir de estado persistido, incluindo status SUPERSEDED", () => {
    const reference = OrganizationExternalReference.reconstitute({
      internalId: 3,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000009",
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 10,
      status: "SUPERSEDED",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });

    expect(reference.getInternalIdForPersistence()).toBe(3);
    expect(reference.getStatus()).toBe("SUPERSEDED");
    expect(reference.isActive()).toBe(false);
    expect(reference.pullDomainEvents()).toHaveLength(0);
  });
});

describe("OrganizationExternalReference — 9. evento organization-external-reference.created", () => {
  it("create() produz exatamente um evento, sem legacyId no payload", () => {
    const reference = createReference({ systemCode: "PCTEC_HUB", entityType: "clientes", legacyId: 321 });

    const events = reference.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("organization-external-reference.created");
    expect(events[0]?.payload).toEqual({
      organizationExternalReferencePublicId: reference.getPublicId().toString(),
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      systemCode: "PCTEC_HUB",
      entityType: "clientes"
    });
    // legacyId nunca aparece no payload do evento (não é identificador
    // cross-system, ADR-031).
    expect(JSON.stringify(events[0]?.payload)).not.toContain("321");
  });
});

describe("OrganizationExternalReference — 10. não expõe internalId publicamente", () => {
  it("getInternalIdForPersistence é undefined antes de persistir", () => {
    const reference = createReference();
    expect(reference.getInternalIdForPersistence()).toBeUndefined();
    reference.assignInternalIdFromPersistence(21);
    expect(reference.getInternalIdForPersistence()).toBe(21);
  });
});
