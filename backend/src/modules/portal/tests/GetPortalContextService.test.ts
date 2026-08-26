import { describe, it, expect } from "vitest";
import { GetPortalContextService } from "../application/GetPortalContextService.js";
import type { MembershipRepository } from "../../organization/domain/MembershipRepository.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../../organization/domain/OrganizationRelationshipRepository.js";
import { Membership } from "../../organization/domain/Membership.js";
import { Organization } from "../../organization/domain/Organization.js";
import { OrganizationRelationship } from "../../organization/domain/OrganizationRelationship.js";
import type { PublicId } from "../../organization/domain/value-objects/PublicId.js";
import type { MembershipProfile } from "../../organization/domain/value-objects/MembershipProfile.js";
import type { OrganizationType } from "../../organization/domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../../organization/domain/value-objects/DocumentNumber.js";
import { InvalidPublicIdError } from "../../identity/domain/value-objects/PublicId.js";
import { MembershipVersionConflictError } from "../../organization/domain/errors/MembershipErrors.js";

/** Fakes em memória — nenhum destes testes toca SQL, mysql2 ou rede real. */
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

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

function buildFixture() {
  const membershipRepository = new InMemoryMembershipRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const organizationRelationshipRepository = new InMemoryOrganizationRelationshipRepository();
  const service = new GetPortalContextService(
    membershipRepository,
    organizationRepository,
    organizationRelationshipRepository
  );
  return { membershipRepository, organizationRepository, organizationRelationshipRepository, service };
}

function createOrganization(type: "BUSINESS_GROUP" | "COMPANY", legalName: string, status?: "ACTIVE" | "INACTIVE") {
  const organization = Organization.create({
    type,
    legalName,
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
  if (status === "INACTIVE") {
    return Organization.reconstitute({
      internalId: 1,
      publicId: organization.getPublicId().toString(),
      type,
      legalName,
      status: "INACTIVE",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }
  return organization;
}

function createMembership(organizationPublicId: string, scope: string, status?: "ACTIVE" | "INACTIVE") {
  const membership = Membership.create({
    identityPublicId: IDENTITY_PUBLIC_ID,
    organizationPublicId,
    profile: "CUSTOMER",
    scope,
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
  if (status === "INACTIVE") {
    return Membership.reconstitute({
      internalId: 1,
      publicId: membership.getPublicId().toString(),
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId,
      profile: "CUSTOMER",
      scope,
      status: "INACTIVE",
      startedAt: new Date(),
      endedAt: new Date(),
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }
  return membership;
}

describe("GetPortalContextService — 1. sem Membership: contexto vazio, não é erro", () => {
  it("retorna organizations: [] quando a Identity não tem nenhum Membership", async () => {
    const { service } = buildFixture();

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    expect(result.identityPublicId).toBe(IDENTITY_PUBLIC_ID);
    expect(result.organizations).toEqual([]);
  });
});

describe("GetPortalContextService — 2. 1 Membership ORGANIZATION_ONLY", () => {
  it("retorna só a própria Organization, sem expandir nada", async () => {
    const { membershipRepository, organizationRepository, service } = buildFixture();
    const company = createOrganization("COMPANY", "Empresa Única");
    await organizationRepository.insert(company);
    await membershipRepository.insert(createMembership(company.getPublicId().toString(), "ORGANIZATION_ONLY"));

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]?.publicId).toBe(company.getPublicId().toString());
  });
});

describe("GetPortalContextService — 3. 1 Membership AND_DESCENDANTS em grupo", () => {
  it("expande para as COMPANY filhas do BUSINESS_GROUP", async () => {
    const { membershipRepository, organizationRepository, organizationRelationshipRepository, service } =
      buildFixture();
    const group = createOrganization("BUSINESS_GROUP", "Grupo Primavera");
    const companyA = createOrganization("COMPANY", "Empresa A");
    const companyB = createOrganization("COMPANY", "Empresa B");
    await organizationRepository.insert(group);
    await organizationRepository.insert(companyA);
    await organizationRepository.insert(companyB);
    await organizationRelationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: companyA.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );
    await organizationRelationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: companyB.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );
    await membershipRepository.insert(
      createMembership(group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS")
    );

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    const publicIds = result.organizations.map((o) => o.publicId).sort();
    expect(publicIds).toEqual(
      [group.getPublicId().toString(), companyA.getPublicId().toString(), companyB.getPublicId().toString()].sort()
    );
  });
});

describe("GetPortalContextService — 4. Membership direto em COMPANY", () => {
  it("Membership ORGANIZATION_ONLY sobre uma COMPANY não tenta expandir descendentes (COMPANY não tem filhos)", async () => {
    const { membershipRepository, organizationRepository, service } = buildFixture();
    const company = createOrganization("COMPANY", "Empresa Direta");
    await organizationRepository.insert(company);
    await membershipRepository.insert(
      createMembership(company.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS")
    );

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    // Mesmo com scope AND_DESCENDANTS, COMPANY não é BUSINESS_GROUP —
    // getType().isBusinessGroup() é false, então não tenta expandir.
    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]?.publicId).toBe(company.getPublicId().toString());
  });
});

describe("GetPortalContextService — 5. múltiplos Memberships", () => {
  it("agrega Organizations de Memberships distintos, em Organizations diferentes", async () => {
    const { membershipRepository, organizationRepository, service } = buildFixture();
    const companyA = createOrganization("COMPANY", "Empresa A");
    const companyB = createOrganization("COMPANY", "Empresa B");
    await organizationRepository.insert(companyA);
    await organizationRepository.insert(companyB);
    await membershipRepository.insert(createMembership(companyA.getPublicId().toString(), "ORGANIZATION_ONLY"));
    await membershipRepository.insert(createMembership(companyB.getPublicId().toString(), "ORGANIZATION_ONLY"));

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    expect(result.organizations).toHaveLength(2);
  });
});

describe("GetPortalContextService — 6. deduplicação", () => {
  it("Membership direto em COMPANY + Membership AND_DESCENDANTS no grupo pai produzindo a MESMA COMPANY: aparece só uma vez", async () => {
    const { membershipRepository, organizationRepository, organizationRelationshipRepository, service } =
      buildFixture();
    const group = createOrganization("BUSINESS_GROUP", "Grupo Dedup");
    const company = createOrganization("COMPANY", "Empresa Dedup");
    await organizationRepository.insert(group);
    await organizationRepository.insert(company);
    await organizationRelationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: company.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );
    // Membership 1: direto na COMPANY.
    await membershipRepository.insert(createMembership(company.getPublicId().toString(), "ORGANIZATION_ONLY"));
    // Membership 2: AND_DESCENDANTS no grupo pai — alcança a MESMA COMPANY.
    await membershipRepository.insert(
      createMembership(group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS")
    );

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    const companyOccurrences = result.organizations.filter((o) => o.publicId === company.getPublicId().toString());
    expect(companyOccurrences).toHaveLength(1);
    // Total: grupo + empresa, cada um uma única vez.
    expect(result.organizations).toHaveLength(2);
  });
});

describe("GetPortalContextService — 7. Membership INACTIVE ignorado", () => {
  it("um Membership INACTIVE nunca participa do contexto, mesmo apontando para Organization ACTIVE", async () => {
    const { membershipRepository, organizationRepository, service } = buildFixture();
    const company = createOrganization("COMPANY", "Empresa Com Membership Inativo");
    await organizationRepository.insert(company);
    await membershipRepository.insert(
      createMembership(company.getPublicId().toString(), "ORGANIZATION_ONLY", "INACTIVE")
    );

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    expect(result.organizations).toEqual([]);
  });
});

describe("GetPortalContextService — 8. Organization INACTIVE não autoriza (defesa em profundidade)", () => {
  it("Membership ACTIVE apontando para Organization INACTIVE não concede acesso a ela, mas outros Memberships válidos continuam", async () => {
    const { membershipRepository, organizationRepository, service } = buildFixture();
    const inactiveCompany = createOrganization("COMPANY", "Empresa Inativa", "INACTIVE");
    const activeCompany = createOrganization("COMPANY", "Empresa Ativa");
    organizationRepository.stored.set(inactiveCompany.getPublicId().toString(), inactiveCompany);
    await organizationRepository.insert(activeCompany);
    await membershipRepository.insert(
      createMembership(inactiveCompany.getPublicId().toString(), "ORGANIZATION_ONLY")
    );
    await membershipRepository.insert(createMembership(activeCompany.getPublicId().toString(), "ORGANIZATION_ONLY"));

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    // A requisição NÃO falha por causa do Membership problemático — só
    // ignora aquela Organization e continua com a válida.
    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]?.publicId).toBe(activeCompany.getPublicId().toString());
  });
});

describe("GetPortalContextService — 9. GROUP descendentes COMPANY", () => {
  it("descendente INACTIVE também é ignorado (mesma defesa em profundidade aplicada a filhos)", async () => {
    const { membershipRepository, organizationRepository, organizationRelationshipRepository, service } =
      buildFixture();
    const group = createOrganization("BUSINESS_GROUP", "Grupo Com Filha Inativa");
    const activeChild = createOrganization("COMPANY", "Filha Ativa");
    const inactiveChild = createOrganization("COMPANY", "Filha Inativa", "INACTIVE");
    await organizationRepository.insert(group);
    await organizationRepository.insert(activeChild);
    organizationRepository.stored.set(inactiveChild.getPublicId().toString(), inactiveChild);
    await organizationRelationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: activeChild.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );
    await organizationRelationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: inactiveChild.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );
    await membershipRepository.insert(
      createMembership(group.getPublicId().toString(), "ORGANIZATION_AND_DESCENDANTS")
    );

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    const publicIds = result.organizations.map((o) => o.publicId);
    expect(publicIds).toContain(group.getPublicId().toString());
    expect(publicIds).toContain(activeChild.getPublicId().toString());
    expect(publicIds).not.toContain(inactiveChild.getPublicId().toString());
    expect(result.organizations).toHaveLength(2);
  });
});

describe("GetPortalContextService — 10. ADMIN PCTEC_INGRESSA sem Membership não ganha escopo", () => {
  it("este service nunca consulta ApplicationAccess — resultado depende exclusivamente de Membership, independente de qualquer status administrativo", async () => {
    const { service } = buildFixture();

    // Nenhum Membership foi criado para esta Identity, independente de
    // ela ser ou não ADMIN de PCTEC_INGRESSA (este service nem tem
    // acesso a essa informação — só MembershipRepository).
    const result = await service.execute(IDENTITY_PUBLIC_ID);

    expect(result.organizations).toEqual([]);
  });
});

describe("GetPortalContextService — payload mínimo", () => {
  it("nunca inclui internalId/legacyId/documentNumber — só publicId/type/legalName/tradeName", async () => {
    const { membershipRepository, organizationRepository, service } = buildFixture();
    const company = createOrganization("COMPANY", "Empresa Payload Mínimo");
    await organizationRepository.insert(company);
    await membershipRepository.insert(createMembership(company.getPublicId().toString(), "ORGANIZATION_ONLY"));

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    const keys = Object.keys(result.organizations[0] ?? {}).sort();
    expect(keys).toEqual(["legalName", "publicId", "tradeName", "type"].sort());
  });
});

describe("GetPortalContextService — validação de publicId", () => {
  it("lança InvalidPublicIdError quando identityPublicId não é um UUID válido", async () => {
    const { service } = buildFixture();

    await expect(service.execute("nao-e-um-uuid")).rejects.toThrow(InvalidPublicIdError);
  });
});
