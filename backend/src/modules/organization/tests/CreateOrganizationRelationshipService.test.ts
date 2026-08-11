import { describe, it, expect } from "vitest";
import { CreateOrganizationRelationshipService } from "../application/CreateOrganizationRelationshipService.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../domain/OrganizationRelationshipRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { Organization } from "../domain/Organization.js";
import { OrganizationRelationship } from "../domain/OrganizationRelationship.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import {
  OrganizationRelationshipParentMustBeBusinessGroupError,
  OrganizationRelationshipChildMustBeCompanyError,
  OrganizationRelationshipParentNotFoundError,
  OrganizationRelationshipChildNotFoundError,
  OrganizationRelationshipChildAlreadyLinkedError
} from "../domain/errors/OrganizationRelationshipErrors.js";

/** Fakes em memória — nenhum destes testes toca SQL, mysql2 ou rede real. */
class InMemoryOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();

  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }

  public async existsByDocumentNumberAndType(_documentNumber: DocumentNumber, _type: OrganizationType): Promise<boolean> {
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
    relationship.assignInternalIdFromPersistence(this.stored.length);
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

const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

function buildOrganization(type: "BUSINESS_GROUP" | "COMPANY", legalName: string): Organization {
  return Organization.create({ type, legalName, actorPublicId: ACTOR_PUBLIC_ID, correlationId: CORRELATION_ID });
}

async function buildFixture() {
  const organizationRepository = new InMemoryOrganizationRepository();
  const organizationRelationshipRepository = new InMemoryOrganizationRelationshipRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();
  const service = new CreateOrganizationRelationshipService(
    new NoopUnitOfWork(),
    () => organizationRepository,
    () => organizationRelationshipRepository,
    () => auditEventRepository
  );
  return { organizationRepository, organizationRelationshipRepository, auditEventRepository, service };
}

describe("CreateOrganizationRelationshipService — 1. GROUP → COMPANY válido", () => {
  it("cria o relacionamento, persiste e grava o evento organization-relationship.created", async () => {
    const { organizationRepository, organizationRelationshipRepository, auditEventRepository, service } =
      await buildFixture();
    const group = buildOrganization("BUSINESS_GROUP", "Grupo Primavera");
    const company = buildOrganization("COMPANY", "Empresa A");
    await organizationRepository.insert(group);
    await organizationRepository.insert(company);

    const result = await service.execute({
      parentOrganizationPublicId: group.getPublicId().toString(),
      childOrganizationPublicId: company.getPublicId().toString(),
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.parentOrganizationPublicId).toBe(group.getPublicId().toString());
    expect(result.childOrganizationPublicId).toBe(company.getPublicId().toString());
    expect(organizationRelationshipRepository.stored).toHaveLength(1);
    expect(auditEventRepository.events).toHaveLength(1);
    expect(auditEventRepository.events[0]?.eventType).toBe("organization-relationship.created");
  });
});

describe("CreateOrganizationRelationshipService — 2. COMPANY → COMPANY inválido", () => {
  it("rejeita quando o parent informado é COMPANY (não BUSINESS_GROUP)", async () => {
    const { organizationRepository, service } = await buildFixture();
    const parentCompany = buildOrganization("COMPANY", "Empresa Pai (inválido)");
    const childCompany = buildOrganization("COMPANY", "Empresa Filha");
    await organizationRepository.insert(parentCompany);
    await organizationRepository.insert(childCompany);

    await expect(
      service.execute({
        parentOrganizationPublicId: parentCompany.getPublicId().toString(),
        childOrganizationPublicId: childCompany.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationRelationshipParentMustBeBusinessGroupError);
  });
});

describe("CreateOrganizationRelationshipService — 3. COMPANY como parent inválido", () => {
  it("mesmo caso do teste anterior, reafirmado com nomenclatura do PO: COMPANY nunca pode ser parent", async () => {
    const { organizationRepository, service } = await buildFixture();
    const parentCompany = buildOrganization("COMPANY", "Empresa Tentando Ser Grupo");
    const childCompany = buildOrganization("COMPANY", "Empresa Filha 2");
    await organizationRepository.insert(parentCompany);
    await organizationRepository.insert(childCompany);

    await expect(
      service.execute({
        parentOrganizationPublicId: parentCompany.getPublicId().toString(),
        childOrganizationPublicId: childCompany.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationRelationshipParentMustBeBusinessGroupError);
  });
});

describe("CreateOrganizationRelationshipService — 4. GROUP como child inválido", () => {
  it("rejeita quando o child informado é BUSINESS_GROUP (não COMPANY)", async () => {
    const { organizationRepository, service } = await buildFixture();
    const parentGroup = buildOrganization("BUSINESS_GROUP", "Grupo Pai");
    const childGroup = buildOrganization("BUSINESS_GROUP", "Grupo Tentando Ser Filho");
    await organizationRepository.insert(parentGroup);
    await organizationRepository.insert(childGroup);

    await expect(
      service.execute({
        parentOrganizationPublicId: parentGroup.getPublicId().toString(),
        childOrganizationPublicId: childGroup.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationRelationshipChildMustBeCompanyError);
  });
});

describe("CreateOrganizationRelationshipService — 5. segunda relação para mesma COMPANY bloqueada", () => {
  it("rejeita vincular uma COMPANY já vinculada a outro BUSINESS_GROUP (uk_org_rel_child)", async () => {
    const { organizationRepository, organizationRelationshipRepository, service } = await buildFixture();
    const firstGroup = buildOrganization("BUSINESS_GROUP", "Primeiro Grupo");
    const secondGroup = buildOrganization("BUSINESS_GROUP", "Segundo Grupo");
    const company = buildOrganization("COMPANY", "Empresa Disputada");
    await organizationRepository.insert(firstGroup);
    await organizationRepository.insert(secondGroup);
    await organizationRepository.insert(company);

    await service.execute({
      parentOrganizationPublicId: firstGroup.getPublicId().toString(),
      childOrganizationPublicId: company.getPublicId().toString(),
      actorPublicId: ACTOR_PUBLIC_ID
    });

    await expect(
      service.execute({
        parentOrganizationPublicId: secondGroup.getPublicId().toString(),
        childOrganizationPublicId: company.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationRelationshipChildAlreadyLinkedError);

    expect(organizationRelationshipRepository.stored).toHaveLength(1);
  });
});

describe("CreateOrganizationRelationshipService — 6. ciclo bloqueado (não aplicável ao MVP)", () => {
  it("hierarquia é de apenas 1 nível (BUSINESS_GROUP -> COMPANY) — não existe caminho para um ciclo nesta fatia, pois child é sempre exigido como COMPANY (nunca BUSINESS_GROUP)", async () => {
    // Documentado explicitamente, não apenas assumido: um ciclo exigiria
    // encadear BUSINESS_GROUP -> BUSINESS_GROUP -> ... -> BUSINESS_GROUP
    // original, o que já é impossível porque child deve ser COMPANY
    // (teste 4, acima). Este teste registra essa garantia estrutural em
    // vez de simplesmente omitir o caso pedido pelo Product Owner.
    const { organizationRepository, service } = await buildFixture();
    const group = buildOrganization("BUSINESS_GROUP", "Grupo Único");
    await organizationRepository.insert(group);

    await expect(
      service.execute({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: group.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationRelationshipChildMustBeCompanyError);
  });
});

describe("CreateOrganizationRelationshipService — 7. entidades inexistentes", () => {
  it("rejeita quando parentOrganizationPublicId não existe", async () => {
    const { organizationRepository, service } = await buildFixture();
    const company = buildOrganization("COMPANY", "Empresa Órfã");
    await organizationRepository.insert(company);

    await expect(
      service.execute({
        parentOrganizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099",
        childOrganizationPublicId: company.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationRelationshipParentNotFoundError);
  });

  it("rejeita quando childOrganizationPublicId não existe", async () => {
    const { organizationRepository, service } = await buildFixture();
    const group = buildOrganization("BUSINESS_GROUP", "Grupo Sozinho");
    await organizationRepository.insert(group);

    await expect(
      service.execute({
        parentOrganizationPublicId: group.getPublicId().toString(),
        childOrganizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000098",
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationRelationshipChildNotFoundError);
  });
});
