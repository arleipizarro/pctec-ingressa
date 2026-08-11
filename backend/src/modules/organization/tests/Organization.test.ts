import { describe, it, expect } from "vitest";
import { Organization } from "../domain/Organization.js";
import { InvalidOrganizationTypeError } from "../domain/value-objects/OrganizationType.js";
import { InvalidLegalNameError } from "../domain/value-objects/LegalName.js";
import { DocumentNumberInvalidError } from "../domain/value-objects/DocumentNumber.js";

const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

describe("Organization — 1. cria COMPANY válida", () => {
  it("cria uma Organization COMPANY com status ACTIVE, version 1 e publicId válido", () => {
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Exemplo LTDA",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.getType().toString()).toBe("COMPANY");
    expect(organization.getLegalName().toString()).toBe("Empresa Exemplo LTDA");
    expect(organization.getStatus()).toBe("ACTIVE");
    expect(organization.isActive()).toBe(true);
    expect(organization.getVersion()).toBe(1);
    expect(organization.getPublicId().toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

describe("Organization — 2. cria BUSINESS_GROUP válido", () => {
  it("cria uma Organization BUSINESS_GROUP com status ACTIVE", () => {
    const organization = Organization.create({
      type: "BUSINESS_GROUP",
      legalName: "Grupo Primavera",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.getType().toString()).toBe("BUSINESS_GROUP");
    expect(organization.getType().isBusinessGroup()).toBe(true);
    expect(organization.getType().isCompany()).toBe(false);
    expect(organization.getStatus()).toBe("ACTIVE");
  });

  it("rejeita type diferente de BUSINESS_GROUP/COMPANY", () => {
    expect(() =>
      Organization.create({
        type: "BRANCH",
        legalName: "Filial X",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    ).toThrow(InvalidOrganizationTypeError);
  });
});

describe("Organization — 3. publicId válido", () => {
  it("dois publicIds gerados em Organizations distintas nunca colidem", () => {
    const a = Organization.create({
      type: "COMPANY",
      legalName: "A",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const b = Organization.create({
      type: "COMPANY",
      legalName: "B",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(a.getPublicId().equals(b.getPublicId())).toBe(false);
  });

  it("exige legalName não vazio", () => {
    expect(() =>
      Organization.create({
        type: "COMPANY",
        legalName: "",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    ).toThrow(InvalidLegalNameError);
  });
});

describe("Organization — 4. documentNumber opcional em BUSINESS_GROUP", () => {
  it("cria BUSINESS_GROUP sem documentNumber (NULL) — grupo comercial frequentemente não tem CNPJ próprio", () => {
    const organization = Organization.create({
      type: "BUSINESS_GROUP",
      legalName: "Grupo Sem CNPJ",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.getDocumentNumber()).toBeUndefined();
  });

  it("também aceita BUSINESS_GROUP COM documentNumber, quando o grupo legitimamente tiver CNPJ próprio", () => {
    const organization = Organization.create({
      type: "BUSINESS_GROUP",
      legalName: "Grupo Com CNPJ Próprio",
      documentNumber: "11.222.333/0001-81",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.getDocumentNumber()?.normalized()).toBe("11222333000181");
  });
});

describe("Organization — 5. COMPANY com documento normalizado", () => {
  it("normaliza documentNumber removendo pontuação (mantém só dígitos)", () => {
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Com CNPJ",
      documentNumber: "11.222.333/0001-81",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.getDocumentNumber()?.toString()).toBe("11222333000181");
    expect(organization.getDocumentNumber()?.normalized()).toBe("11222333000181");
  });

  it("aceita COMPANY sem documentNumber (também opcional para COMPANY, ADR-031 §2)", () => {
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Sem CNPJ Ainda",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.getDocumentNumber()).toBeUndefined();
  });

  it("rejeita documentNumber com formato inválido (diferente de 14 dígitos)", () => {
    expect(() =>
      Organization.create({
        type: "COMPANY",
        legalName: "Empresa X",
        documentNumber: "123",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    ).toThrow(DocumentNumberInvalidError);
  });
});

describe("Organization — 6. status ACTIVE", () => {
  it("toda Organization recém-criada nasce com status ACTIVE (não há fluxo de aprovação nesta fatia)", () => {
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Ativa",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.getStatus()).toBe("ACTIVE");
  });
});

describe("Organization — 7. reconstituição", () => {
  it("reconstrói uma Organization a partir de estado persistido, incluindo tradeName/documentNumber presentes", () => {
    const organization = Organization.reconstitute({
      internalId: 42,
      publicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      type: "COMPANY",
      legalName: "Empresa Reconstituída LTDA",
      tradeName: "Empresa Fantasia",
      documentNumber: "11222333000181",
      status: "ACTIVE",
      version: 3,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });

    expect(organization.getInternalIdForPersistence()).toBe(42);
    expect(organization.getPublicId().toString()).toBe("66231e51-66fb-466d-af4f-ac7b925ca9ec");
    expect(organization.getLegalName().toString()).toBe("Empresa Reconstituída LTDA");
    expect(organization.getTradeName()?.toString()).toBe("Empresa Fantasia");
    expect(organization.getDocumentNumber()?.toString()).toBe("11222333000181");
    expect(organization.getVersion()).toBe(3);
    expect(organization.pullDomainEvents()).toEqual([]);
  });

  it("reconstituição não produz nenhum evento de domínio (diferente de create())", () => {
    const organization = Organization.reconstitute({
      internalId: 1,
      publicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      type: "BUSINESS_GROUP",
      legalName: "Grupo X",
      status: "ACTIVE",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(organization.pullDomainEvents()).toHaveLength(0);
  });
});

describe("Organization — 8. sem comando de mutação nesta fatia (G1)", () => {
  it("version permanece 1 após create() — nenhum método incrementa version, porque G1 não implementa update()", () => {
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Sem Update",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.getVersion()).toBe(1);
    // Documentação explícita: Organization não expõe update()/activate()/
    // inactivate() nesta fatia — verificado estruturalmente (nenhum
    // desses métodos existe no protótipo), não seria possível chamar
    // algo que não existe. Optimistic locking (ADR-024) permanece
    // reservado para quando um comando de mutação for aprovado (mesmo
    // princípio já documentado em Application.ts, v0.5.0).
    expect((organization as unknown as { update?: unknown }).update).toBeUndefined();
    expect((organization as unknown as { activate?: unknown }).activate).toBeUndefined();
  });
});

describe("Organization — 9. não expõe internalId publicamente", () => {
  it("getInternalIdForPersistence só é acessível via método explícito de infraestrutura, undefined antes de persistir", () => {
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Nova",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.getInternalIdForPersistence()).toBeUndefined();
    organization.assignInternalIdFromPersistence(7);
    expect(organization.getInternalIdForPersistence()).toBe(7);
  });

  it("nenhum getter público comum (fora do sufixo ForPersistence) retorna internalId", () => {
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Nova 2",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    organization.assignInternalIdFromPersistence(99);

    const publicKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(organization)).filter(
      (name) => name.startsWith("get") && !name.endsWith("ForPersistence")
    );
    for (const key of publicKeys) {
      const getter = (organization as unknown as Record<string, () => unknown>)[key];
      if (getter === undefined) {
        continue;
      }
      const value = getter.call(organization);
      expect(value).not.toBe(99);
    }
  });
});

describe("Organization — 10. evento de domínio organization.created", () => {
  it("create() produz exatamente um evento organization.created com payload sem dados sensíveis", () => {
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Com Evento",
      documentNumber: "11222333000181",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    const events = organization.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("organization.created");
    expect(events[0]?.actorPublicId).toBe(ACTOR_PUBLIC_ID);
    expect(events[0]?.correlationId).toBe(CORRELATION_ID);
    expect(events[0]?.payload).toEqual({
      organizationPublicId: organization.getPublicId().toString(),
      type: "COMPANY",
      hasDocumentNumber: true
    });
    // Nunca publica o documentNumber completo (Pendente de decisão sobre
    // mascaramento, CATALOGO-DE-EVENTOS.md) — só a presença (boolean).
    expect(JSON.stringify(events[0]?.payload)).not.toContain("11222333000181");
  });

  it("pullDomainEvents() limpa a lista — chamada seguinte retorna vazio", () => {
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa X",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(organization.pullDomainEvents()).toHaveLength(1);
    expect(organization.pullDomainEvents()).toHaveLength(0);
  });
});
