import { describe, it, expect } from "vitest";
import { RequireOrganizationAccessService } from "../application/RequireOrganizationAccessService.js";
import { GetPortalContextService } from "../application/GetPortalContextService.js";
import { OrganizationAccessDeniedError } from "../domain/errors/PortalErrors.js";
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
import { MembershipVersionConflictError } from "../../organization/domain/errors/MembershipErrors.js";

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
  public async existsByChildOrganizationPublicId(_childOrganizationPublicId: PublicId): Promise<boolean> {
    return false;
  }
  public async findChildrenByParentPublicId(_parentPublicId: PublicId): Promise<OrganizationRelationship[]> {
    return [];
  }
  public async insert(_relationship: OrganizationRelationship): Promise<void> {
    // não exercitado neste conjunto de testes
  }
}

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

function buildFixture() {
  const membershipRepository = new InMemoryMembershipRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const organizationRelationshipRepository = new InMemoryOrganizationRelationshipRepository();
  const getPortalContextService = new GetPortalContextService(
    membershipRepository,
    organizationRepository,
    organizationRelationshipRepository
  );
  const service = new RequireOrganizationAccessService(getPortalContextService);
  return { membershipRepository, organizationRepository, getPortalContextService, service };
}

describe("RequireOrganizationAccessService — organization dentro do scope", () => {
  it("permite (não lança) quando organizationPublicId está no PortalContext efetivo", async () => {
    const { membershipRepository, organizationRepository, service } = buildFixture();
    const company = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Permitida",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await organizationRepository.insert(company);
    await membershipRepository.insert(
      Membership.create({
        identityPublicId: IDENTITY_PUBLIC_ID,
        organizationPublicId: company.getPublicId().toString(),
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    // P1D: passou a devolver o PortalContext que usou para autorizar —
    // é ele que a rota tenant-scope repassa como conjunto autorizado.
    const contexto = await service.execute(IDENTITY_PUBLIC_ID, company.getPublicId().toString());
    expect(contexto.identityPublicId).toBe(IDENTITY_PUBLIC_ID);
    expect(contexto.organizations.map((o) => o.publicId)).toContain(company.getPublicId().toString());
  });
});

describe("RequireOrganizationAccessService — fora do scope", () => {
  it("rejeita com OrganizationAccessDeniedError (403) quando a Organization existe mas não está no PortalContext da Identity", async () => {
    const { organizationRepository, service } = buildFixture();
    const otherCompany = Organization.create({
      type: "COMPANY",
      legalName: "Empresa De Outra Identity",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await organizationRepository.insert(otherCompany);
    // Nenhum Membership criado para IDENTITY_PUBLIC_ID.

    await expect(
      service.execute(IDENTITY_PUBLIC_ID, otherCompany.getPublicId().toString())
    ).rejects.toThrow(OrganizationAccessDeniedError);
  });
});

describe("RequireOrganizationAccessService — descendente permitido por AND_DESCENDANTS", () => {
  it("permite uma COMPANY filha quando o Membership é AND_DESCENDANTS no BUSINESS_GROUP pai", async () => {
    const membershipRepository = new InMemoryMembershipRepository();
    const organizationRepository = new InMemoryOrganizationRepository();
    class FakeRelationshipRepo implements OrganizationRelationshipRepository {
      public async existsByChildOrganizationPublicId(): Promise<boolean> {
        return true;
      }
      public async findChildrenByParentPublicId(): Promise<OrganizationRelationship[]> {
        return [
          OrganizationRelationship.create({
            parentOrganizationPublicId: group.getPublicId().toString(),
            childOrganizationPublicId: child.getPublicId().toString(),
            actorPublicId: ACTOR_PUBLIC_ID,
            correlationId: CORRELATION_ID
          })
        ];
      }
      public async insert(): Promise<void> {
        // não exercitado
      }
    }
    const group = Organization.create({
      type: "BUSINESS_GROUP",
      legalName: "Grupo Pai",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const child = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Filha",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await organizationRepository.insert(group);
    await organizationRepository.insert(child);
    await membershipRepository.insert(
      Membership.create({
        identityPublicId: IDENTITY_PUBLIC_ID,
        organizationPublicId: group.getPublicId().toString(),
        profile: "CUSTOMER",
        scope: "ORGANIZATION_AND_DESCENDANTS",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );
    const getPortalContextService = new GetPortalContextService(
      membershipRepository,
      organizationRepository,
      new FakeRelationshipRepo()
    );
    const service = new RequireOrganizationAccessService(getPortalContextService);

    const contexto = await service.execute(IDENTITY_PUBLIC_ID, child.getPublicId().toString());
    // O contexto devolvido contém a filha alcançada por AND_DESCENDANTS —
    // é exatamente essa informação que permite ao tenant-scope consolidar
    // só o que a Identity alcança.
    expect(contexto.organizations.map((o) => o.publicId)).toContain(child.getPublicId().toString());
  });
});

describe("RequireOrganizationAccessService — COMPANY fora do grupo", () => {
  it("rejeita uma COMPANY que não é filha de nenhum grupo com Membership da Identity", async () => {
    const { membershipRepository, organizationRepository, service } = buildFixture();
    const unrelatedCompany = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Sem Relação",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const memberOrganization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Do Membership",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await organizationRepository.insert(unrelatedCompany);
    await organizationRepository.insert(memberOrganization);
    await membershipRepository.insert(
      Membership.create({
        identityPublicId: IDENTITY_PUBLIC_ID,
        organizationPublicId: memberOrganization.getPublicId().toString(),
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    await expect(
      service.execute(IDENTITY_PUBLIC_ID, unrelatedCompany.getPublicId().toString())
    ).rejects.toThrow(OrganizationAccessDeniedError);
  });
});

describe("RequireOrganizationAccessService — organization INACTIVE", () => {
  it("rejeita mesmo com Membership ACTIVE, se a Organization referenciada está INACTIVE (defesa em profundidade)", async () => {
    const { membershipRepository, organizationRepository, service } = buildFixture();
    const activeMembershipOrg = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Inativa",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const inactiveOrganization = Organization.reconstitute({
      internalId: 1,
      publicId: activeMembershipOrg.getPublicId().toString(),
      type: "COMPANY",
      legalName: "Empresa Inativa",
      status: "INACTIVE",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    organizationRepository.stored.set(inactiveOrganization.getPublicId().toString(), inactiveOrganization);
    await membershipRepository.insert(
      Membership.create({
        identityPublicId: IDENTITY_PUBLIC_ID,
        organizationPublicId: inactiveOrganization.getPublicId().toString(),
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    await expect(
      service.execute(IDENTITY_PUBLIC_ID, inactiveOrganization.getPublicId().toString())
    ).rejects.toThrow(OrganizationAccessDeniedError);
  });
});

describe("RequireOrganizationAccessService — nunca confia em organizationPublicId sem revalidar", () => {
  it("um publicId com formato válido mas nunca visto é sempre negado — nunca 'confia' apenas por vir formatado como UUID", async () => {
    const { service } = buildFixture();

    await expect(
      service.execute(IDENTITY_PUBLIC_ID, "0b13f6f0-8f3a-4a1e-9c2d-000000009999")
    ).rejects.toThrow(OrganizationAccessDeniedError);
  });
});

// ---------------------------------------------------------------------------
// P1D — o contexto devolvido é o MESMO usado para autorizar
// ---------------------------------------------------------------------------

describe("RequireOrganizationAccessService — contexto devolvido (P1D)", () => {
  it("devolve exatamente o PortalContext consultado, sem recalcular", async () => {
    const { membershipRepository, organizationRepository, getPortalContextService, service } = buildFixture();
    const company = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Do Contexto",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await organizationRepository.insert(company);
    await membershipRepository.insert(
      Membership.create({
        identityPublicId: IDENTITY_PUBLIC_ID,
        organizationPublicId: company.getPublicId().toString(),
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    const esperado = await getPortalContextService.execute(IDENTITY_PUBLIC_ID);
    const devolvido = await service.execute(IDENTITY_PUBLIC_ID, company.getPublicId().toString());

    expect(devolvido).toEqual(esperado);
  });

  it("Membership ORGANIZATION_ONLY em BUSINESS_GROUP: contexto devolvido tem o grupo e NENHUMA filha", async () => {
    // É esta propriedade que a rota tenant-scope usa para não expandir
    // filhas que a Identity não alcança (C-1).
    const membershipRepository = new InMemoryMembershipRepository();
    const organizationRepository = new InMemoryOrganizationRepository();
    const group = Organization.create({
      type: "BUSINESS_GROUP",
      legalName: "Grupo Sem Descendencia",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const child = Organization.create({
      type: "COMPANY",
      legalName: "Filha Inalcancavel",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await organizationRepository.insert(group);
    await organizationRepository.insert(child);
    const relationship = OrganizationRelationship.create({
      parentOrganizationPublicId: group.getPublicId().toString(),
      childOrganizationPublicId: child.getPublicId().toString(),
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    class RelRepo implements OrganizationRelationshipRepository {
      public async existsByChildOrganizationPublicId(): Promise<boolean> {
        return true;
      }
      public async findChildrenByParentPublicId(): Promise<OrganizationRelationship[]> {
        return [relationship];
      }
      public async insert(): Promise<void> {
        /* não usado */
      }
    }
    await membershipRepository.insert(
      Membership.create({
        identityPublicId: IDENTITY_PUBLIC_ID,
        organizationPublicId: group.getPublicId().toString(),
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );
    const service = new RequireOrganizationAccessService(
      new GetPortalContextService(membershipRepository, organizationRepository, new RelRepo())
    );

    const contexto = await service.execute(IDENTITY_PUBLIC_ID, group.getPublicId().toString());

    expect(contexto.organizations.map((o) => o.publicId)).toEqual([group.getPublicId().toString()]);
    expect(contexto.organizations.map((o) => o.publicId)).not.toContain(child.getPublicId().toString());
  });
});
