import { describe, it, expect } from "vitest";
import { ResolvePortalTenantScopeService } from "../application/ResolvePortalTenantScopeService.js";
import { GetActiveOrganizationExternalReferenceService } from "../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { OrganizationAccessDeniedError } from "../domain/errors/PortalErrors.js";
import { OrganizationExternalReferenceNotFoundError } from "../../organization/domain/errors/OrganizationExternalReferenceErrors.js";
import { Organization } from "../../organization/domain/Organization.js";
import { OrganizationRelationship } from "../../organization/domain/OrganizationRelationship.js";
import { OrganizationExternalReference } from "../../organization/domain/OrganizationExternalReference.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../../organization/domain/OrganizationRelationshipRepository.js";
import type { OrganizationExternalReferenceRepository } from "../../organization/domain/OrganizationExternalReferenceRepository.js";
import type { PublicId } from "../../organization/domain/value-objects/PublicId.js";
import type { SystemCode } from "../../organization/domain/value-objects/SystemCode.js";
import type { EntityType } from "../../organization/domain/value-objects/EntityType.js";
import type { LegacyId } from "../../organization/domain/value-objects/LegacyId.js";
import type { OrganizationType } from "../../organization/domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../../organization/domain/value-objects/DocumentNumber.js";

/**
 * Testes unitários de `ResolvePortalTenantScopeService` — P1D (v0.7.x).
 *
 * Fakes 100% em memória: nenhum destes testes toca SQL, mysql2, rede ou
 * o ambiente DEV. Os UUIDs do piloto AFIP aparecem só como fixtures
 * legíveis — nenhuma regra do service depende deles.
 */

const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

class InMemoryOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();
  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async existsByDocumentNumberAndType(_d: DocumentNumber, _t: OrganizationType): Promise<boolean> {
    return false;
  }
  public async insert(organization: Organization): Promise<void> {
    this.stored.set(organization.getPublicId().toString(), organization);
  }
}

class InMemoryOrganizationRelationshipRepository implements OrganizationRelationshipRepository {
  public readonly stored: OrganizationRelationship[] = [];
  public async existsByChildOrganizationPublicId(childOrganizationPublicId: PublicId): Promise<boolean> {
    return this.stored.some((r) => r.getChildOrganizationPublicId().equals(childOrganizationPublicId));
  }
  public async findChildrenByParentPublicId(parentPublicId: PublicId): Promise<OrganizationRelationship[]> {
    return this.stored.filter((r) => r.getParentOrganizationPublicId().equals(parentPublicId));
  }
  public async insert(relationship: OrganizationRelationship): Promise<void> {
    this.stored.push(relationship);
  }
}

class InMemoryOrganizationExternalReferenceRepository implements OrganizationExternalReferenceRepository {
  public readonly stored: OrganizationExternalReference[] = [];
  /** Toda chamada resolvida, na ordem — prova quais organizações foram consultadas. */
  public readonly lookups: Array<{ organizationPublicId: string; systemCode: string; entityType: string }> = [];

  public async existsActiveBySystemCodeEntityTypeAndLegacyId(
    _s: SystemCode,
    _e: EntityType,
    _l: LegacyId
  ): Promise<boolean> {
    return false;
  }
  public async findByPublicId(publicId: PublicId): Promise<OrganizationExternalReference | undefined> {
    return this.stored.find((r) => r.getPublicId().equals(publicId));
  }
  public async findActiveByOrganizationSystemCodeAndEntityType(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<OrganizationExternalReference | undefined> {
    this.lookups.push({
      organizationPublicId: organizationPublicId.toString(),
      systemCode: systemCode.toString(),
      entityType: entityType.toString()
    });
    return this.stored.find(
      (r) =>
        r.getOrganizationPublicId() === organizationPublicId.toString() &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType) &&
        r.isActive()
    );
  }
  public async insert(reference: OrganizationExternalReference): Promise<void> {
    this.stored.push(reference);
  }
}

function createOrganization(
  type: "BUSINESS_GROUP" | "COMPANY",
  legalName: string,
  options: { tradeName?: string; status?: "ACTIVE" | "INACTIVE" } = {}
): Organization {
  const organization = Organization.create({
    type,
    legalName,
    tradeName: options.tradeName,
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
  if (options.status !== "INACTIVE") {
    return organization;
  }
  return Organization.reconstitute({
    internalId: 1,
    publicId: organization.getPublicId().toString(),
    type,
    legalName,
    tradeName: options.tradeName,
    status: "INACTIVE",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

function createReference(organizationPublicId: string, legacyId: number): OrganizationExternalReference {
  return OrganizationExternalReference.create({
    organizationPublicId,
    systemCode: "PCTEC_PORTAL",
    entityType: "clientes",
    legacyId,
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
}

interface Fixture {
  readonly organizationRepository: InMemoryOrganizationRepository;
  readonly relationshipRepository: InMemoryOrganizationRelationshipRepository;
  readonly referenceRepository: InMemoryOrganizationExternalReferenceRepository;
  readonly service: ResolvePortalTenantScopeService;
}

function buildFixture(): Fixture {
  const organizationRepository = new InMemoryOrganizationRepository();
  const relationshipRepository = new InMemoryOrganizationRelationshipRepository();
  const referenceRepository = new InMemoryOrganizationExternalReferenceRepository();
  const service = new ResolvePortalTenantScopeService(
    organizationRepository,
    relationshipRepository,
    new GetActiveOrganizationExternalReferenceService(referenceRepository)
  );
  return { organizationRepository, relationshipRepository, referenceRepository, service };
}

/**
 * Grupo do piloto: AFIP (BUSINESS_GROUP) com quatro COMPANY filhas, cada
 * uma com sua referência `PCTEC_PORTAL/clientes`. Os legacyIds imitam os
 * do DEV real (77/75/78/76) só para deixar o teste legível — nenhuma
 * regra depende dos valores.
 */
function buildAfipGroup(fixture: Fixture) {
  const group = createOrganization("BUSINESS_GROUP", "ASSOCIACAO FUNDO DE INCENTIVO A PESQUISA", {
    tradeName: "AFIP"
  });
  const children = [
    { organization: createOrganization("COMPANY", "AFIP BELGICA", { tradeName: "AFIP - BELGICA" }), legacyId: 77 },
    { organization: createOrganization("COMPANY", "AFIP BOSQUE", { tradeName: "AFIP - BOSQUE" }), legacyId: 75 },
    { organization: createOrganization("COMPANY", "AFIP CLEMENTINO", { tradeName: "AFIP - CLEMENTINO" }), legacyId: 78 },
    { organization: createOrganization("COMPANY", "AFIP SANTANA", { tradeName: "AFIP - SANTANA" }), legacyId: 76 }
  ];

  void fixture.organizationRepository.insert(group);
  for (const child of children) {
    void fixture.organizationRepository.insert(child.organization);
    void fixture.referenceRepository.insert(
      createReference(child.organization.getPublicId().toString(), child.legacyId)
    );
    void fixture.relationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: child.organization.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );
  }

  return { group, children };
}

// ---------------------------------------------------------------------------
// COMPANY — comportamento individual (compatibilidade com P1A.1)
// ---------------------------------------------------------------------------

describe("ResolvePortalTenantScopeService — seleção COMPANY", () => {
  it("A. COMPANY resolve exatamente uma organização, com o próprio legacyId", async () => {
    const fixture = buildFixture();
    const company = createOrganization("COMPANY", "AFIP BOSQUE", { tradeName: "AFIP - BOSQUE" });
    await fixture.organizationRepository.insert(company);
    await fixture.referenceRepository.insert(createReference(company.getPublicId().toString(), 75));

    const scope = await fixture.service.execute(company.getPublicId().toString());

    expect(scope.selection.type).toBe("COMPANY");
    expect(scope.selection.publicId).toBe(company.getPublicId().toString());
    expect(scope.organizations).toHaveLength(1);
    expect(scope.organizations[0]?.legacyId).toBe(75);
    expect(scope.organizations[0]?.publicId).toBe(company.getPublicId().toString());
  });

  it("B. COMPANY sem referência comercial ACTIVE → falha fechada (404 de domínio)", async () => {
    const fixture = buildFixture();
    const company = createOrganization("COMPANY", "PCTEC");
    await fixture.organizationRepository.insert(company);

    await expect(fixture.service.execute(company.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationExternalReferenceNotFoundError
    );
  });

  it("C. COMPANY nunca consulta relações de hierarquia", async () => {
    const fixture = buildFixture();
    const company = createOrganization("COMPANY", "AFIP BOSQUE");
    await fixture.organizationRepository.insert(company);
    await fixture.referenceRepository.insert(createReference(company.getPublicId().toString(), 75));

    await fixture.service.execute(company.getPublicId().toString());

    // Uma única resolução de referência — a da própria COMPANY.
    expect(fixture.referenceRepository.lookups).toHaveLength(1);
    expect(fixture.referenceRepository.lookups[0]?.organizationPublicId).toBe(company.getPublicId().toString());
  });
});

// ---------------------------------------------------------------------------
// BUSINESS_GROUP — consolidação
// ---------------------------------------------------------------------------

describe("ResolvePortalTenantScopeService — seleção BUSINESS_GROUP", () => {
  it("D. BUSINESS_GROUP expande em todas as COMPANY filhas ACTIVE", async () => {
    const fixture = buildFixture();
    const { group } = buildAfipGroup(fixture);

    const scope = await fixture.service.execute(group.getPublicId().toString());

    expect(scope.selection.type).toBe("BUSINESS_GROUP");
    expect(scope.selection.tradeName).toBe("AFIP");
    expect(scope.organizations).toHaveLength(4);
    expect(scope.organizations.map((o) => o.legacyId).sort((a, b) => a - b)).toEqual([75, 76, 77, 78]);
    expect(scope.organizations.every((o) => o.type === "COMPANY")).toBe(true);
  });

  it("E. o próprio BUSINESS_GROUP nunca aparece em organizations[] nem tem legacyId resolvido", async () => {
    const fixture = buildFixture();
    const { group } = buildAfipGroup(fixture);

    const scope = await fixture.service.execute(group.getPublicId().toString());

    expect(scope.organizations.some((o) => o.publicId === group.getPublicId().toString())).toBe(false);
    expect(fixture.referenceRepository.lookups.map((l) => l.organizationPublicId)).not.toContain(
      group.getPublicId().toString()
    );
  });

  it("F. COMPANY filha INACTIVE é ignorada — nunca falha a consolidação", async () => {
    const fixture = buildFixture();
    const { group } = buildAfipGroup(fixture);

    const inativa = createOrganization("COMPANY", "AFIP ENCERRADA", { status: "INACTIVE" });
    await fixture.organizationRepository.insert(inativa);
    await fixture.relationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: inativa.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    const scope = await fixture.service.execute(group.getPublicId().toString());

    expect(scope.organizations).toHaveLength(4);
    // Nem sequer tenta resolver referência de uma filha INACTIVE.
    expect(fixture.referenceRepository.lookups.map((l) => l.organizationPublicId)).not.toContain(
      inativa.getPublicId().toString()
    );
  });

  it("G. FAIL-CLOSED: filha ACTIVE sem referência comercial derruba a consolidação inteira", async () => {
    const fixture = buildFixture();
    const { group } = buildAfipGroup(fixture);

    const semReferencia = createOrganization("COMPANY", "AFIP NOVA");
    await fixture.organizationRepository.insert(semReferencia);
    await fixture.relationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: semReferencia.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    // Nunca "consolida o que der": um total silenciosamente incompleto
    // seria lido como verdade pelo usuário.
    await expect(fixture.service.execute(group.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationExternalReferenceNotFoundError
    );
  });

  it("H. filha alcançada por relações duplicadas aparece uma única vez", async () => {
    const fixture = buildFixture();
    const { group, children } = buildAfipGroup(fixture);
    const repetida = children[0]!.organization;

    await fixture.relationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: repetida.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    const scope = await fixture.service.execute(group.getPublicId().toString());

    expect(scope.organizations).toHaveLength(4);
    const publicIds = scope.organizations.map((o) => o.publicId);
    expect(new Set(publicIds).size).toBe(publicIds.length);
    // Deduplicação acontece ANTES da resolução — a referência da filha
    // repetida é consultada uma única vez.
    expect(
      fixture.referenceRepository.lookups.filter((l) => l.organizationPublicId === repetida.getPublicId().toString())
    ).toHaveLength(1);
  });

  it("I. BUSINESS_GROUP sem nenhuma filha ACTIVE → organizations vazio, sem erro", async () => {
    const fixture = buildFixture();
    const group = createOrganization("BUSINESS_GROUP", "GRUPO RECEM CADASTRADO", { tradeName: "NOVO" });
    await fixture.organizationRepository.insert(group);

    const scope = await fixture.service.execute(group.getPublicId().toString());

    expect(scope.selection.type).toBe("BUSINESS_GROUP");
    expect(scope.organizations).toEqual([]);
  });

  it("J. sempre resolve PCTEC_PORTAL/clientes — nunca clientes_grupo", async () => {
    const fixture = buildFixture();
    const { group } = buildAfipGroup(fixture);

    await fixture.service.execute(group.getPublicId().toString());

    expect(fixture.referenceRepository.lookups).toHaveLength(4);
    for (const lookup of fixture.referenceRepository.lookups) {
      expect(lookup.systemCode).toBe("PCTEC_PORTAL");
      expect(lookup.entityType).toBe("clientes");
    }
  });
});

// ---------------------------------------------------------------------------
// Defesa em profundidade e sanitização de payload
// ---------------------------------------------------------------------------

describe("ResolvePortalTenantScopeService — defesa em profundidade", () => {
  it("K. Organization inexistente → ORGANIZATION_ACCESS_DENIED (403), nunca 404", async () => {
    const fixture = buildFixture();
    const inexistente = createOrganization("COMPANY", "NAO PERSISTIDA");

    await expect(fixture.service.execute(inexistente.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationAccessDeniedError
    );
  });

  it("L. Organization INACTIVE selecionada → ORGANIZATION_ACCESS_DENIED, nunca resolve referência", async () => {
    const fixture = buildFixture();
    const inativa = createOrganization("COMPANY", "AFIP ENCERRADA", { status: "INACTIVE" });
    await fixture.organizationRepository.insert(inativa);
    await fixture.referenceRepository.insert(createReference(inativa.getPublicId().toString(), 99));

    await expect(fixture.service.execute(inativa.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationAccessDeniedError
    );
    expect(fixture.referenceRepository.lookups).toHaveLength(0);
  });

  it("M. resultado nunca carrega internalId nem qualquer campo além do contrato", async () => {
    const fixture = buildFixture();
    const { group } = buildAfipGroup(fixture);

    const scope = await fixture.service.execute(group.getPublicId().toString());

    expect(Object.keys(scope).sort()).toEqual(["organizations", "selection"]);
    expect(Object.keys(scope.selection).sort()).toEqual(["legalName", "publicId", "tradeName", "type"]);
    for (const organization of scope.organizations) {
      expect(Object.keys(organization).sort()).toEqual(["legacyId", "legalName", "publicId", "tradeName", "type"]);
    }
    const raw = JSON.stringify(scope);
    expect(raw).not.toContain("internalId");
    expect(raw).not.toContain("documentNumber");
    expect(raw).not.toContain("identityPublicId");
  });

  it("N. este service nunca recebe identityPublicId — autorização é do boundary anterior", () => {
    // Prova estrutural do boundary: a assinatura pública tem exatamente
    // um parâmetro, o organizationPublicId já autorizado.
    expect(ResolvePortalTenantScopeService.prototype.execute.length).toBe(1);
  });
});
