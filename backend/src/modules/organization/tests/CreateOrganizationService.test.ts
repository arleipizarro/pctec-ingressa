import { describe, it, expect } from "vitest";
import { CreateOrganizationService } from "../application/CreateOrganizationService.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { Organization } from "../domain/Organization.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import { OrganizationDocumentAlreadyExistsError } from "../domain/errors/OrganizationErrors.js";

/** Fakes em memória — nenhum destes testes toca SQL, mysql2 ou rede real. */
class InMemoryOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();

  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }

  public async existsByDocumentNumberAndType(documentNumber: DocumentNumber, type: OrganizationType): Promise<boolean> {
    for (const organization of this.stored.values()) {
      if (
        organization.getDocumentNumber()?.equals(documentNumber) === true &&
        organization.getType().equals(type)
      ) {
        return true;
      }
    }
    return false;
  }

  public async insert(organization: Organization): Promise<void> {
    this.stored.set(organization.getPublicId().toString(), organization);
    organization.assignInternalIdFromPersistence(this.stored.size);
  }

  /** Duplo: a trava otimista real está no SQL; aqui a escrita é no-op. */
  public async update(_organization: Organization, _expectedVersion: number): Promise<void> {
    // sem estado a atualizar neste duplo
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

function buildService(organizationRepository: InMemoryOrganizationRepository, auditEventRepository: InMemoryAuditEventRepository) {
  return new CreateOrganizationService(
    new NoopUnitOfWork(),
    () => organizationRepository,
    () => auditEventRepository
  );
}

const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

describe("CreateOrganizationService", () => {
  it("cria uma Organization COMPANY, persiste e grava o evento organization.created", async () => {
    const organizationRepository = new InMemoryOrganizationRepository();
    const auditEventRepository = new InMemoryAuditEventRepository();
    const service = buildService(organizationRepository, auditEventRepository);

    const result = await service.execute({
      type: "COMPANY",
      legalName: "Empresa Application Service LTDA",
      documentNumber: "11.222.333/0001-81",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.type).toBe("COMPANY");
    expect(result.status).toBe("ACTIVE");
    expect(result.version).toBe(1);
    expect(organizationRepository.stored.has(result.publicId)).toBe(true);
    expect(auditEventRepository.events).toHaveLength(1);
    expect(auditEventRepository.events[0]?.eventType).toBe("organization.created");
  });

  it("cria uma Organization BUSINESS_GROUP sem documentNumber", async () => {
    const organizationRepository = new InMemoryOrganizationRepository();
    const auditEventRepository = new InMemoryAuditEventRepository();
    const service = buildService(organizationRepository, auditEventRepository);

    const result = await service.execute({
      type: "BUSINESS_GROUP",
      legalName: "Grupo Application Service",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.type).toBe("BUSINESS_GROUP");
    const stored = organizationRepository.stored.get(result.publicId);
    expect(stored?.getDocumentNumber()).toBeUndefined();
  });

  it("rejeita documentNumber já usado por outra Organization do MESMO type (ORGANIZATION_DOCUMENT_ALREADY_EXISTS), sem persistir a nova", async () => {
    const organizationRepository = new InMemoryOrganizationRepository();
    const auditEventRepository = new InMemoryAuditEventRepository();
    const service = buildService(organizationRepository, auditEventRepository);

    await service.execute({
      type: "COMPANY",
      legalName: "Primeira Empresa",
      documentNumber: "11.222.333/0001-81",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    await expect(
      service.execute({
        type: "COMPANY",
        legalName: "Segunda Empresa, mesmo CNPJ",
        documentNumber: "11.222.333/0001-81",
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationDocumentAlreadyExistsError);

    expect(organizationRepository.stored.size).toBe(1);
  });

  it("permite o MESMO documentNumber em types DIFERENTES (unicidade é condicionada ao par document_number+type, uk_organizations_document_type)", async () => {
    const organizationRepository = new InMemoryOrganizationRepository();
    const auditEventRepository = new InMemoryAuditEventRepository();
    const service = buildService(organizationRepository, auditEventRepository);

    await service.execute({
      type: "COMPANY",
      legalName: "Empresa",
      documentNumber: "11.222.333/0001-81",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    // Não deve lançar — mesmo documentNumber, type diferente.
    await expect(
      service.execute({
        type: "BUSINESS_GROUP",
        legalName: "Grupo, mesmo número por coincidência de teste",
        documentNumber: "11.222.333/0001-81",
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).resolves.toBeDefined();

    expect(organizationRepository.stored.size).toBe(2);
  });

  it("gera um correlationId automaticamente quando não informado", async () => {
    const organizationRepository = new InMemoryOrganizationRepository();
    const auditEventRepository = new InMemoryAuditEventRepository();
    const service = buildService(organizationRepository, auditEventRepository);

    await service.execute({
      type: "COMPANY",
      legalName: "Empresa Sem Correlation Id",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(auditEventRepository.events[0]?.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
