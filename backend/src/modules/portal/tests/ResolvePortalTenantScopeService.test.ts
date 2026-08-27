import { describe, it, expect } from "vitest";
import { ResolvePortalTenantScopeService } from "../application/ResolvePortalTenantScopeService.js";
import { GetPortalContextService } from "../application/GetPortalContextService.js";
import { RequireOrganizationAccessService } from "../application/RequireOrganizationAccessService.js";
import { GetActiveOrganizationExternalReferenceService } from "../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { OrganizationAccessDeniedError } from "../domain/errors/PortalErrors.js";
import { OrganizationExternalReferenceNotFoundError } from "../../organization/domain/errors/OrganizationExternalReferenceErrors.js";
import { Organization } from "../../organization/domain/Organization.js";
import { Membership } from "../../organization/domain/Membership.js";
import { OrganizationRelationship } from "../../organization/domain/OrganizationRelationship.js";
import { OrganizationExternalReference } from "../../organization/domain/OrganizationExternalReference.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../../organization/domain/OrganizationRelationshipRepository.js";
import type { OrganizationExternalReferenceRepository } from "../../organization/domain/OrganizationExternalReferenceRepository.js";
import type { MembershipRepository } from "../../organization/domain/MembershipRepository.js";
import type { PublicId } from "../../organization/domain/value-objects/PublicId.js";
import type { SystemCode } from "../../organization/domain/value-objects/SystemCode.js";
import type { EntityType } from "../../organization/domain/value-objects/EntityType.js";
import type { LegacyId } from "../../organization/domain/value-objects/LegacyId.js";
import type { OrganizationType } from "../../organization/domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../../organization/domain/value-objects/DocumentNumber.js";
import type { MembershipProfile } from "../../organization/domain/value-objects/MembershipProfile.js";
import { MembershipVersionConflictError } from "../../organization/domain/errors/MembershipErrors.js";

/**
 * Testes unitários de `ResolvePortalTenantScopeService` — P1D (v0.7.x),
 * revisados após o achado C-1.
 *
 * **O conjunto autorizado NÃO é montado à mão nestes testes.** Ele é
 * derivado do `PortalContext` real, calculado por
 * `GetPortalContextService` a partir de `Membership`s de verdade — a
 * mesma cadeia que a rota usa em produção. Sem isso, um teste que
 * passasse um `Set` construído manualmente provaria apenas que o filtro
 * existe, nunca que ele reflete o `scope` do Membership — que é
 * exatamente onde estava o defeito.
 *
 * Fakes 100% em memória: nenhum destes testes toca SQL, mysql2, rede ou
 * o ambiente DEV. Os UUIDs do piloto AFIP aparecem só como fixtures
 * legíveis — nenhuma regra do service depende deles.
 */

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
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
  /** Duplo: a trava otimista real está no SQL; aqui só registra a escrita. */
  public async update(organization: Organization, _expectedVersion: number): Promise<void> {
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

class InMemoryMembershipRepository implements MembershipRepository {
  public readonly stored: Membership[] = [];
  public async existsByIdentityOrganizationAndProfile(
    identityPublicId: string,
    organizationPublicId: string,
    profile: MembershipProfile
  ): Promise<boolean> {
    return this.stored.some(
      (m) =>
        m.getIdentityPublicId() === identityPublicId &&
        m.getOrganizationPublicId() === organizationPublicId &&
        m.getProfile().equals(profile)
    );
  }
  public async findAllByIdentityPublicId(identityPublicId: string): Promise<Membership[]> {
    return this.stored.filter((m) => m.getIdentityPublicId() === identityPublicId);
  }
  public async findActiveByIdentityPublicId(identityPublicId: string): Promise<Membership[]> {
    return this.stored.filter((m) => m.getIdentityPublicId() === identityPublicId && m.isActive());
  }
  public async findByPublicId(publicId: PublicId): Promise<Membership | undefined> {
    return this.stored.find((m) => m.getPublicId().equals(publicId));
  }
  public async update(membership: Membership, expectedVersion: number): Promise<void> {
    const indice = this.stored.findIndex((m) => m.getPublicId().equals(membership.getPublicId()));
    if (indice === -1 || this.stored[indice]!.getVersion() !== expectedVersion) {
      throw new MembershipVersionConflictError(expectedVersion, membership.getVersion());
    }
    this.stored[indice] = membership;
  }
  public async insert(membership: Membership): Promise<void> {
    this.stored.push(membership);
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
  /**
   * Estes duplos nunca modelam ambiguidade — nenhuma destas suítes trata
   * de "duas referências ACTIVE para a mesma organização". Delegar à
   * busca de uma só mantém o duplo honesto sobre o que ele representa,
   * em vez de inventar um segundo armazenamento paralelo.
   */
  public async findAllActiveByOrganizationSystemCodeAndEntityType(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<readonly OrganizationExternalReference[]> {
    const unica = await this.findActiveByOrganizationSystemCodeAndEntityType(
      organizationPublicId,
      systemCode,
      entityType
    );
    return unica === undefined ? [] : [unica];
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
  readonly membershipRepository: InMemoryMembershipRepository;
  readonly service: ResolvePortalTenantScopeService;
  readonly requireOrganizationAccessService: RequireOrganizationAccessService;
  /**
   * Reproduz o pipeline REAL da rota: autoriza a seleção e usa o
   * `PortalContext` devolvido como conjunto autorizado. É por aqui que
   * todo teste de escopo passa — nunca por um `Set` montado à mão.
   */
  readonly resolverComoNaRota: (organizationPublicId: string) => Promise<
    Awaited<ReturnType<ResolvePortalTenantScopeService["execute"]>>
  >;
}

function buildFixture(): Fixture {
  const organizationRepository = new InMemoryOrganizationRepository();
  const relationshipRepository = new InMemoryOrganizationRelationshipRepository();
  const referenceRepository = new InMemoryOrganizationExternalReferenceRepository();
  const membershipRepository = new InMemoryMembershipRepository();

  const getPortalContextService = new GetPortalContextService(
    membershipRepository,
    organizationRepository,
    relationshipRepository
  );
  const requireOrganizationAccessService = new RequireOrganizationAccessService(getPortalContextService);
  const service = new ResolvePortalTenantScopeService(
    organizationRepository,
    relationshipRepository,
    new GetActiveOrganizationExternalReferenceService(referenceRepository)
  );

  const resolverComoNaRota = async (organizationPublicId: string) => {
    const portalContext = await requireOrganizationAccessService.execute(IDENTITY_PUBLIC_ID, organizationPublicId);
    return service.execute(
      organizationPublicId,
      new Set(portalContext.organizations.map((organization) => organization.publicId))
    );
  };

  return {
    organizationRepository,
    relationshipRepository,
    referenceRepository,
    membershipRepository,
    service,
    requireOrganizationAccessService,
    resolverComoNaRota
  };
}

async function darMembership(
  fixture: Fixture,
  organizationPublicId: string,
  scope: "ORGANIZATION_ONLY" | "ORGANIZATION_AND_DESCENDANTS"
): Promise<void> {
  await fixture.membershipRepository.insert(
    Membership.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId,
      profile: "CUSTOMER",
      scope,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    })
  );
}

/**
 * Grupo do piloto: AFIP (BUSINESS_GROUP) com quatro COMPANY filhas, cada
 * uma com sua referência `PCTEC_PORTAL/clientes`. Os legacyIds imitam os
 * do DEV real (77/75/78/76) só para deixar o teste legível — nenhuma
 * regra depende dos valores.
 */
async function buildAfipGroup(fixture: Fixture) {
  const group = createOrganization("BUSINESS_GROUP", "ASSOCIACAO FUNDO DE INCENTIVO A PESQUISA", {
    tradeName: "AFIP"
  });
  const children = [
    { organization: createOrganization("COMPANY", "AFIP BELGICA", { tradeName: "AFIP - BELGICA" }), legacyId: 77 },
    { organization: createOrganization("COMPANY", "AFIP BOSQUE", { tradeName: "AFIP - BOSQUE" }), legacyId: 75 },
    { organization: createOrganization("COMPANY", "AFIP CLEMENTINO", { tradeName: "AFIP - CLEMENTINO" }), legacyId: 78 },
    { organization: createOrganization("COMPANY", "AFIP SANTANA", { tradeName: "AFIP - SANTANA" }), legacyId: 76 }
  ];

  await fixture.organizationRepository.insert(group);
  for (const child of children) {
    await fixture.organizationRepository.insert(child.organization);
    await fixture.referenceRepository.insert(
      createReference(child.organization.getPublicId().toString(), child.legacyId)
    );
    await fixture.relationshipRepository.insert(
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
// C-1 — o scope do Membership decide o alcance do grupo
// ---------------------------------------------------------------------------

describe("ResolvePortalTenantScopeService — escopo respeita o MembershipScope (C-1)", () => {
  it("C1-a. Membership ORGANIZATION_ONLY no BUSINESS_GROUP não alcança NENHUMA filha → 403", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);
    // "alcance comercial limitado à própria Organization" (MembershipScope).
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_ONLY");

    // O grupo ESTÁ no PortalContext (o acesso à seleção é legítimo)...
    const contexto = await fixture.requireOrganizationAccessService.execute(
      IDENTITY_PUBLIC_ID,
      group.getPublicId().toString()
    );
    expect(contexto.organizations.map((o) => o.publicId)).toEqual([group.getPublicId().toString()]);

    // ...mas nenhuma filha é alcançável, então não há escopo comercial.
    await expect(fixture.resolverComoNaRota(group.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationAccessDeniedError
    );
  });

  it("C1-b. ORGANIZATION_ONLY: nenhuma referência comercial de filha é sequer consultada", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_ONLY");

    await expect(fixture.resolverComoNaRota(group.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationAccessDeniedError
    );
    // Nem o legacyId nem o nome de qualquer filha chegam a existir.
    expect(fixture.referenceRepository.lookups).toHaveLength(0);
  });

  it("C1-c. Membership AND_DESCENDANTS alcança somente as filhas presentes no PortalContext", async () => {
    const fixture = buildFixture();
    const { group, children } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

    // Uma quinta filha canônica que o contexto NÃO alcança: INACTIVE, logo
    // GetPortalContextService a exclui (defesa em profundidade).
    const foraDoContexto = createOrganization("COMPANY", "AFIP DESATIVADA", { status: "INACTIVE" });
    await fixture.organizationRepository.insert(foraDoContexto);
    await fixture.referenceRepository.insert(createReference(foraDoContexto.getPublicId().toString(), 999));
    await fixture.relationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: foraDoContexto.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    const scope = await fixture.resolverComoNaRota(group.getPublicId().toString());

    expect(scope.organizations).toHaveLength(4);
    expect(scope.organizations.map((o) => o.publicId).sort()).toEqual(
      children.map((c) => c.organization.getPublicId().toString()).sort()
    );
    expect(scope.organizations.some((o) => o.publicId === foraDoContexto.getPublicId().toString())).toBe(false);
  });

  it("C1-d. filha canônica fora do PortalContext nunca tem a referência consultada", async () => {
    const fixture = buildFixture();
    const { group, children } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

    const foraDoContexto = createOrganization("COMPANY", "AFIP DESATIVADA", { status: "INACTIVE" });
    await fixture.organizationRepository.insert(foraDoContexto);
    await fixture.referenceRepository.insert(createReference(foraDoContexto.getPublicId().toString(), 999));
    await fixture.relationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: foraDoContexto.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    await fixture.resolverComoNaRota(group.getPublicId().toString());

    const consultadas = fixture.referenceRepository.lookups.map((l) => l.organizationPublicId);
    expect(consultadas).not.toContain(foraDoContexto.getPublicId().toString());
    expect(consultadas.sort()).toEqual(children.map((c) => c.organization.getPublicId().toString()).sort());
  });

  it("C1-e. piloto AFIP com AND_DESCENDANTS continua devolvendo as QUATRO empresas", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

    const scope = await fixture.resolverComoNaRota(group.getPublicId().toString());

    expect(scope.selection.type).toBe("BUSINESS_GROUP");
    expect(scope.selection.tradeName).toBe("AFIP");
    expect(scope.organizations).toHaveLength(4);
    expect(scope.organizations.map((o) => o.legacyId).sort((a, b) => a - b)).toEqual([75, 76, 77, 78]);
  });

  it("C1-f. consolidação sem nenhuma filha autorizada falha fechada — nunca escopo vazio", async () => {
    const fixture = buildFixture();
    // Grupo autorizado, porém sem nenhuma relação canônica.
    const group = createOrganization("BUSINESS_GROUP", "GRUPO RECEM CADASTRADO", { tradeName: "NOVO" });
    await fixture.organizationRepository.insert(group);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

    await expect(fixture.resolverComoNaRota(group.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationAccessDeniedError
    );
  });

  it("C1-g. o conjunto autorizado é obrigatório: sem ele o service não expande nada", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

    // Chamada direta com conjunto vazio — simula um chamador futuro que
    // esquecesse de propagar o contexto. Falha fechada, nunca "expande
    // tudo por padrão".
    await expect(fixture.service.execute(group.getPublicId().toString(), new Set())).rejects.toBeInstanceOf(
      OrganizationAccessDeniedError
    );
    expect(fixture.referenceRepository.lookups).toHaveLength(0);
  });

  it("C1-h. conjunto ausente/inválido (chamador JS puro) → 403, nunca TypeError nem expansão", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);

    // O TypeScript exige o parâmetro; esta é a defesa em profundidade
    // para um chamador que o omitisse em tempo de execução.
    for (const invalido of [undefined, null, [], "tudo"]) {
      await expect(
        fixture.service.execute(group.getPublicId().toString(), invalido as unknown as ReadonlySet<string>)
      ).rejects.toBeInstanceOf(OrganizationAccessDeniedError);
    }
    expect(fixture.referenceRepository.lookups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// COMPANY — comportamento individual (compatibilidade com P1A.1)
// ---------------------------------------------------------------------------

describe("ResolvePortalTenantScopeService — seleção COMPANY", () => {
  it("A. COMPANY autorizada resolve exatamente uma organização, com o próprio legacyId", async () => {
    const fixture = buildFixture();
    const company = createOrganization("COMPANY", "AFIP BOSQUE", { tradeName: "AFIP - BOSQUE" });
    await fixture.organizationRepository.insert(company);
    await fixture.referenceRepository.insert(createReference(company.getPublicId().toString(), 75));
    await darMembership(fixture, company.getPublicId().toString(), "ORGANIZATION_ONLY");

    const scope = await fixture.resolverComoNaRota(company.getPublicId().toString());

    expect(scope.selection.type).toBe("COMPANY");
    expect(scope.selection.publicId).toBe(company.getPublicId().toString());
    expect(scope.organizations).toHaveLength(1);
    expect(scope.organizations[0]?.legacyId).toBe(75);
    expect(scope.organizations[0]?.publicId).toBe(company.getPublicId().toString());
  });

  it("A-b. COMPANY filha continua selecionável individualmente sob AND_DESCENDANTS", async () => {
    const fixture = buildFixture();
    const { group, children } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");
    const bosque = children[1]!.organization;

    const scope = await fixture.resolverComoNaRota(bosque.getPublicId().toString());

    expect(scope.selection.type).toBe("COMPANY");
    expect(scope.organizations).toHaveLength(1);
    expect(scope.organizations[0]?.legacyId).toBe(75);
  });

  it("B. COMPANY autorizada sem referência comercial ACTIVE → falha fechada (404 de domínio)", async () => {
    const fixture = buildFixture();
    const company = createOrganization("COMPANY", "PCTEC");
    await fixture.organizationRepository.insert(company);
    await darMembership(fixture, company.getPublicId().toString(), "ORGANIZATION_ONLY");

    await expect(fixture.resolverComoNaRota(company.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationExternalReferenceNotFoundError
    );
  });

  it("C. COMPANY nunca consulta relações de hierarquia", async () => {
    const fixture = buildFixture();
    const company = createOrganization("COMPANY", "AFIP BOSQUE");
    await fixture.organizationRepository.insert(company);
    await fixture.referenceRepository.insert(createReference(company.getPublicId().toString(), 75));
    await darMembership(fixture, company.getPublicId().toString(), "ORGANIZATION_ONLY");

    await fixture.resolverComoNaRota(company.getPublicId().toString());

    // Uma única resolução de referência — a da própria COMPANY.
    expect(fixture.referenceRepository.lookups).toHaveLength(1);
    expect(fixture.referenceRepository.lookups[0]?.organizationPublicId).toBe(company.getPublicId().toString());
  });

  it("C-b. COMPANY fora do conjunto autorizado → 403, referência nunca consultada", async () => {
    const fixture = buildFixture();
    const company = createOrganization("COMPANY", "EMPRESA DE OUTRA IDENTITY");
    await fixture.organizationRepository.insert(company);
    await fixture.referenceRepository.insert(createReference(company.getPublicId().toString(), 999));
    // Nenhum Membership para esta Identity.

    await expect(fixture.resolverComoNaRota(company.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationAccessDeniedError
    );
    expect(fixture.referenceRepository.lookups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BUSINESS_GROUP — consolidação
// ---------------------------------------------------------------------------

describe("ResolvePortalTenantScopeService — seleção BUSINESS_GROUP", () => {
  it("E. o próprio BUSINESS_GROUP nunca aparece em organizations[] nem tem legacyId resolvido", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

    const scope = await fixture.resolverComoNaRota(group.getPublicId().toString());

    expect(scope.organizations.some((o) => o.publicId === group.getPublicId().toString())).toBe(false);
    expect(fixture.referenceRepository.lookups.map((l) => l.organizationPublicId)).not.toContain(
      group.getPublicId().toString()
    );
  });

  it("F. COMPANY filha INACTIVE é ignorada — nunca falha a consolidação", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

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

    const scope = await fixture.resolverComoNaRota(group.getPublicId().toString());

    expect(scope.organizations).toHaveLength(4);
    expect(fixture.referenceRepository.lookups.map((l) => l.organizationPublicId)).not.toContain(
      inativa.getPublicId().toString()
    );
  });

  it("G. FAIL-CLOSED: filha autorizada e ACTIVE sem referência derruba a consolidação inteira", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);

    // Filha ACTIVE e alcançável pelo contexto, porém sem referência.
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
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

    // Nunca "consolida o que der": um total silenciosamente incompleto
    // seria lido como verdade pelo usuário.
    await expect(fixture.resolverComoNaRota(group.getPublicId().toString())).rejects.toBeInstanceOf(
      OrganizationExternalReferenceNotFoundError
    );
  });

  it("H. filha alcançada por relações duplicadas aparece uma única vez", async () => {
    const fixture = buildFixture();
    const { group, children } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");
    const repetida = children[0]!.organization;

    await fixture.relationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: repetida.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    const scope = await fixture.resolverComoNaRota(group.getPublicId().toString());

    expect(scope.organizations).toHaveLength(4);
    const publicIds = scope.organizations.map((o) => o.publicId);
    expect(new Set(publicIds).size).toBe(publicIds.length);
    // Deduplicação acontece ANTES da resolução — a referência da filha
    // repetida é consultada uma única vez.
    expect(
      fixture.referenceRepository.lookups.filter((l) => l.organizationPublicId === repetida.getPublicId().toString())
    ).toHaveLength(1);
  });

  it("J. sempre resolve PCTEC_PORTAL/clientes — nunca clientes_grupo", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

    await fixture.resolverComoNaRota(group.getPublicId().toString());

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

    await expect(
      fixture.service.execute(
        inexistente.getPublicId().toString(),
        new Set([inexistente.getPublicId().toString()])
      )
    ).rejects.toBeInstanceOf(OrganizationAccessDeniedError);
  });

  it("L. Organization INACTIVE selecionada → ORGANIZATION_ACCESS_DENIED, nunca resolve referência", async () => {
    const fixture = buildFixture();
    const inativa = createOrganization("COMPANY", "AFIP ENCERRADA", { status: "INACTIVE" });
    await fixture.organizationRepository.insert(inativa);
    await fixture.referenceRepository.insert(createReference(inativa.getPublicId().toString(), 99));

    // Mesmo que um chamador insistisse em declará-la autorizada, o
    // status INACTIVE barra antes de qualquer resolução.
    await expect(
      fixture.service.execute(inativa.getPublicId().toString(), new Set([inativa.getPublicId().toString()]))
    ).rejects.toBeInstanceOf(OrganizationAccessDeniedError);
    expect(fixture.referenceRepository.lookups).toHaveLength(0);
  });

  it("M. resultado nunca carrega internalId nem qualquer campo além do contrato", async () => {
    const fixture = buildFixture();
    const { group } = await buildAfipGroup(fixture);
    await darMembership(fixture, group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS");

    const scope = await fixture.resolverComoNaRota(group.getPublicId().toString());

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

  it("N. o service exige o conjunto autorizado na assinatura — nunca decide sozinho o alcance", () => {
    // Substitui a guarda anterior, que afirmava `execute.length === 1`
    // como se "não receber contexto" fosse virtude de boundary. Era
    // justamente a assinatura que impedia respeitar o MembershipScope
    // (achado C-1). O boundary correto continua: o service não CALCULA
    // autorização (não recebe identityPublicId, não consulta Membership),
    // mas é OBRIGADO a receber e respeitar o que já foi autorizado.
    expect(ResolvePortalTenantScopeService.prototype.execute.length).toBe(2);
    const construtor = ResolvePortalTenantScopeService.prototype.constructor.toString();
    expect(construtor).not.toContain("MembershipRepository");
    expect(construtor).not.toContain("identityPublicId");
  });
});
