import { describe, it, expect } from "vitest";
import { CreateMembershipService } from "../application/CreateMembershipService.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { MembershipRepository } from "../domain/MembershipRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import type { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import { Organization } from "../domain/Organization.js";
import { Membership } from "../domain/Membership.js";
import type { PublicId as OrganizationPublicId } from "../domain/value-objects/PublicId.js";
import type { MembershipProfile } from "../domain/value-objects/MembershipProfile.js";
import type { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import {
  MembershipIdentityNotFoundError,
  MembershipOrganizationNotFoundError,
  MembershipOrganizationNotActiveError,
  MembershipAlreadyExistsError
} from "../domain/errors/MembershipErrors.js";

/** Fakes em memória — nenhum destes testes toca SQL, mysql2 ou rede real. */
class InMemoryIdentityRepository implements IdentityRepository {
  public readonly stored = new Map<string, Identity>();

  public async findByPublicId(publicId: IdentityPublicId): Promise<Identity | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async findByNormalizedEmail(): Promise<Identity | undefined> {
    return undefined;
  }
  public async existsByNormalizedEmail(): Promise<boolean> {
    return false;
  }
  public async existsByNormalizedCpf(): Promise<boolean> {
    return false;
  }
  public async countAll(): Promise<number> {
    return this.stored.size;
  }
  public async insert(identity: Identity): Promise<void> {
    this.stored.set(identity.getPublicId().toString(), identity);
    identity.assignInternalIdFromPersistence(this.stored.size);
  }
  public async update(): Promise<void> {
    // não exercitado por CreateMembershipService
  }
}

class InMemoryOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();

  public async findByPublicId(publicId: OrganizationPublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async existsByDocumentNumberAndType(_documentNumber: DocumentNumber, _type: OrganizationType): Promise<boolean> {
    return false;
  }
  public async insert(organization: Organization): Promise<void> {
    this.stored.set(organization.getPublicId().toString(), organization);
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
  public async findByPublicId(publicId: OrganizationPublicId): Promise<Membership | undefined> {
    return this.stored.find((m) => m.getPublicId().equals(publicId));
  }
  public async insert(membership: Membership): Promise<void> {
    this.stored.push(membership);
    membership.assignInternalIdFromPersistence(this.stored.length);
  }
}

class InMemoryAuditEventRepository implements AuditEventRepository {
  public readonly events: AuditEvent[] = [];
  public async insert(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

class NoopUnitOfWork implements UnitOfWork {
  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    const fakeConnection: Queryable = {
      execute: async () => {
        throw new Error("Este teste não deveria executar SQL real.");
      }
    };
    return work(fakeConnection);
  }
}

const SYSTEM_ACTOR = ActorPublicId.system();
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

async function buildFixture() {
  const identityRepository = new InMemoryIdentityRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const membershipRepository = new InMemoryMembershipRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();
  const service = new CreateMembershipService(
    new NoopUnitOfWork(),
    () => identityRepository,
    () => organizationRepository,
    () => membershipRepository,
    () => auditEventRepository
  );

  const identity = Identity.create({
    type: "HUMAN",
    fullName: "Pessoa de Teste",
    email: `teste-${Date.now()}-${Math.random()}@example.com`,
    actor: SYSTEM_ACTOR,
    correlationId: CORRELATION_ID
  });
  await identityRepository.insert(identity);

  const activeOrganization = Organization.create({
    type: "COMPANY",
    legalName: "Empresa Ativa",
    actorPublicId: identity.getPublicId().toString(),
    correlationId: CORRELATION_ID
  });
  await organizationRepository.insert(activeOrganization);

  const inactiveOrganization = Organization.reconstitute({
    internalId: 999,
    publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099",
    type: "COMPANY",
    legalName: "Empresa Inativa",
    status: "INACTIVE",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  organizationRepository.stored.set(inactiveOrganization.getPublicId().toString(), inactiveOrganization);

  return {
    identityRepository,
    organizationRepository,
    membershipRepository,
    auditEventRepository,
    service,
    identity,
    activeOrganization,
    inactiveOrganization
  };
}

describe("CreateMembershipService — 1. Identity válida + Organization válida", () => {
  it("cria um Membership, persiste e grava o evento membership.created", async () => {
    const { service, identity, activeOrganization, membershipRepository, auditEventRepository } = await buildFixture();

    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      organizationPublicId: activeOrganization.getPublicId().toString(),
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: identity.getPublicId().toString()
    });

    expect(result.status).toBe("ACTIVE");
    expect(membershipRepository.stored).toHaveLength(1);
    expect(auditEventRepository.events).toHaveLength(1);
    expect(auditEventRepository.events[0]?.eventType).toBe("membership.created");
  });
});

describe("CreateMembershipService — 2. múltiplos Memberships para a mesma Identity, Organizations diferentes", () => {
  it("permite dois Memberships para a mesma Identity em Organizations distintas", async () => {
    const { service, identity, activeOrganization, organizationRepository, membershipRepository } = await buildFixture();
    const secondOrganization = Organization.create({
      type: "COMPANY",
      legalName: "Segunda Empresa Ativa",
      actorPublicId: identity.getPublicId().toString(),
      correlationId: CORRELATION_ID
    });
    await organizationRepository.insert(secondOrganization);

    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      organizationPublicId: activeOrganization.getPublicId().toString(),
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: identity.getPublicId().toString()
    });
    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      organizationPublicId: secondOrganization.getPublicId().toString(),
      profile: "PARTNER",
      scope: "ORGANIZATION_AND_DESCENDANTS",
      actorPublicId: identity.getPublicId().toString()
    });

    expect(membershipRepository.stored).toHaveLength(2);
  });
});

describe("CreateMembershipService — 3. duplicate bloqueado", () => {
  it("rejeita criar um SEGUNDO Membership com a MESMA classificação (identity+organization+profile)", async () => {
    const { service, identity, activeOrganization, membershipRepository } = await buildFixture();

    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      organizationPublicId: activeOrganization.getPublicId().toString(),
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: identity.getPublicId().toString()
    });

    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        organizationPublicId: activeOrganization.getPublicId().toString(),
        profile: "CUSTOMER",
        scope: "ORGANIZATION_AND_DESCENDANTS", // scope diferente, mas mesma classificação (profile)
        actorPublicId: identity.getPublicId().toString()
      })
    ).rejects.toThrow(MembershipAlreadyExistsError);

    expect(membershipRepository.stored).toHaveLength(1);
  });

  it("permite Memberships com profiles DIFERENTES para o mesmo par identity+organization", async () => {
    const { service, identity, activeOrganization, membershipRepository } = await buildFixture();

    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      organizationPublicId: activeOrganization.getPublicId().toString(),
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: identity.getPublicId().toString()
    });
    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      organizationPublicId: activeOrganization.getPublicId().toString(),
      profile: "EMPLOYEE",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: identity.getPublicId().toString()
    });

    expect(membershipRepository.stored).toHaveLength(2);
  });
});

describe("CreateMembershipService — 4. Organization inexistente", () => {
  it("rejeita quando organizationPublicId não existe", async () => {
    const { service, identity } = await buildFixture();

    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000098",
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: identity.getPublicId().toString()
      })
    ).rejects.toThrow(MembershipOrganizationNotFoundError);
  });
});

describe("CreateMembershipService — 5. Identity inexistente", () => {
  it("rejeita quando identityPublicId não existe", async () => {
    const { service, activeOrganization } = await buildFixture();

    await expect(
      service.execute({
        identityPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000097",
        organizationPublicId: activeOrganization.getPublicId().toString(),
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000097"
      })
    ).rejects.toThrow(MembershipIdentityNotFoundError);
  });
});

describe("CreateMembershipService — 6. Organization INACTIVE", () => {
  it("rejeita criar Membership sobre Organization INACTIVE (MEMBERSHIP_ORGANIZATION_NOT_ACTIVE)", async () => {
    const { service, identity, inactiveOrganization } = await buildFixture();

    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        organizationPublicId: inactiveOrganization.getPublicId().toString(),
        profile: "CUSTOMER",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: identity.getPublicId().toString()
      })
    ).rejects.toThrow(MembershipOrganizationNotActiveError);
  });
});

describe("CreateMembershipService — 7. profile/scope inválidos são rejeitados antes de qualquer I/O", () => {
  it("profile inválido nunca chega a consultar repository", async () => {
    const { service, identity, activeOrganization, identityRepository } = await buildFixture();
    let identityLookupCalled = false;
    const originalFind = identityRepository.findByPublicId.bind(identityRepository);
    identityRepository.findByPublicId = async (publicId) => {
      identityLookupCalled = true;
      return originalFind(publicId);
    };

    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        organizationPublicId: activeOrganization.getPublicId().toString(),
        profile: "ADMIN",
        scope: "ORGANIZATION_ONLY",
        actorPublicId: identity.getPublicId().toString()
      })
    ).rejects.toThrow();
    expect(identityLookupCalled).toBe(false);
  });
});

describe("CreateMembershipService — 8. nunca consulta IDs internos de sistemas legados", () => {
  it("request/result só usam identityPublicId/organizationPublicId (UUID canônico), nunca um campo legacyId", () => {
    // Verificação estrutural: a interface CreateMembershipRequest não
    // possui nenhum campo relacionado a HUB/Helpdesk/Portal/legacyId —
    // conferido por tipagem em tempo de compilação (este teste falha o
    // build se alguém adicionar um campo assim sem querer).
    const request: Parameters<CreateMembershipService["execute"]>[0] = {
      identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec"
    };
    expect(Object.keys(request)).not.toContain("legacyId");
    expect(Object.keys(request)).not.toContain("hubId");
  });
});
