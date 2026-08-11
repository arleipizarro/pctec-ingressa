import { describe, it, expect } from "vitest";
import { CreateOrganizationExternalReferenceService } from "../application/CreateOrganizationExternalReferenceService.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { Organization } from "../domain/Organization.js";
import { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { LegacyId } from "../domain/value-objects/LegacyId.js";
import {
  OrganizationExternalReferenceOrganizationNotFoundError,
  OrganizationExternalReferenceAlreadyExistsError
} from "../domain/errors/OrganizationExternalReferenceErrors.js";

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

class InMemoryOrganizationExternalReferenceRepository implements OrganizationExternalReferenceRepository {
  public readonly stored: OrganizationExternalReference[] = [];
  public async existsActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<boolean> {
    return this.stored.some(
      (r) =>
        r.isActive() &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType) &&
        r.getLegacyId().equals(legacyId)
    );
  }
  public async findByPublicId(publicId: PublicId): Promise<OrganizationExternalReference | undefined> {
    return this.stored.find((r) => r.getPublicId().equals(publicId));
  }
  public async insert(reference: OrganizationExternalReference): Promise<void> {
    this.stored.push(reference);
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

async function buildFixture() {
  const organizationRepository = new InMemoryOrganizationRepository();
  const referenceRepository = new InMemoryOrganizationExternalReferenceRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();
  const service = new CreateOrganizationExternalReferenceService(
    new NoopUnitOfWork(),
    () => organizationRepository,
    () => referenceRepository,
    () => auditEventRepository
  );
  const organization = Organization.create({
    type: "COMPANY",
    legalName: "Empresa Referenciada",
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
  await organizationRepository.insert(organization);
  return { organizationRepository, referenceRepository, auditEventRepository, service, organization };
}

describe("CreateOrganizationExternalReferenceService — 1. cria referência HUB", () => {
  it("cria, persiste e grava organization-external-reference.created", async () => {
    const { service, organization, referenceRepository, auditEventRepository } = await buildFixture();

    const result = await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 10,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.systemCode).toBe("PCTEC_HUB");
    expect(referenceRepository.stored).toHaveLength(1);
    expect(auditEventRepository.events[0]?.eventType).toBe("organization-external-reference.created");
  });
});

describe("CreateOrganizationExternalReferenceService — 2/3. cria referência Portal e Helpdesk", () => {
  it("cria referência PCTEC_PORTAL", async () => {
    const { service, organization } = await buildFixture();
    const result = await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 20,
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(result.systemCode).toBe("PCTEC_PORTAL");
  });

  it("cria referência PCTEC_HELPDESK", async () => {
    const { service, organization } = await buildFixture();
    const result = await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HELPDESK",
      entityType: "clients",
      legacyId: 30,
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(result.systemCode).toBe("PCTEC_HELPDESK");
  });
});

describe("CreateOrganizationExternalReferenceService — 4. mesmo legacyId em sistemas diferentes permitido", () => {
  it("HUB e Portal com o mesmo legacyId, mesma entityType, não colidem", async () => {
    const { service, organization, referenceRepository } = await buildFixture();

    await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 55,
      actorPublicId: ACTOR_PUBLIC_ID
    });
    await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 55,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(referenceRepository.stored).toHaveLength(2);
  });
});

describe("CreateOrganizationExternalReferenceService — 5. mesmo system+entityType+legacyId bloqueado", () => {
  it("rejeita segunda referência com a MESMA combinação (system_code, entity_type, legacy_id)", async () => {
    const { service, organization, referenceRepository } = await buildFixture();

    await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 77,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    await expect(
      service.execute({
        organizationPublicId: organization.getPublicId().toString(),
        systemCode: "PCTEC_HUB",
        entityType: "clientes",
        legacyId: 77,
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationExternalReferenceAlreadyExistsError);

    expect(referenceRepository.stored).toHaveLength(1);
  });
});

describe("CreateOrganizationExternalReferenceService — 6. publicId próprio", () => {
  it("cada referência tem publicId distinto da Organization e das demais referências", async () => {
    const { service, organization } = await buildFixture();
    const a = await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 1,
      actorPublicId: ACTOR_PUBLIC_ID
    });
    const b = await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes_grupo",
      legacyId: 1,
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(a.publicId).not.toBe(b.publicId);
    expect(a.publicId).not.toBe(organization.getPublicId().toString());
  });
});

describe("CreateOrganizationExternalReferenceService — 7. Organization inexistente bloqueada", () => {
  it("rejeita quando organizationPublicId não existe", async () => {
    const { service } = await buildFixture();

    await expect(
      service.execute({
        organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099",
        systemCode: "PCTEC_HUB",
        entityType: "clientes",
        legacyId: 1,
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationExternalReferenceOrganizationNotFoundError);
  });
});

describe("CreateOrganizationExternalReferenceService — 8. status/lifecycle aprovado", () => {
  it("toda referência nasce com status ACTIVE (SUPERSEDED fica para o processo de correção, fora de escopo G2)", async () => {
    const { service, organization } = await buildFixture();
    const result = await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 1,
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(result.status).toBe("ACTIVE");
  });
});

describe("CreateOrganizationExternalReferenceService — 9. histórico ACTIVE/SUPERSEDED (revisão do PO, antes do commit de G2)", () => {
  it("A) legacy key sem NENHUMA referência: pode criar ACTIVE normalmente", async () => {
    const { service, organization, referenceRepository } = await buildFixture();

    const result = await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 100,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.status).toBe("ACTIVE");
    expect(referenceRepository.stored).toHaveLength(1);
  });

  it("B) mesma legacy key já tem uma referência ACTIVE: criação de outra ACTIVE é bloqueada", async () => {
    const { service, organization, referenceRepository } = await buildFixture();

    await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 101,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    await expect(
      service.execute({
        organizationPublicId: organization.getPublicId().toString(),
        systemCode: "PCTEC_HUB",
        entityType: "clientes",
        legacyId: 101,
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationExternalReferenceAlreadyExistsError);

    expect(referenceRepository.stored).toHaveLength(1);
  });

  it("C) mesma legacy key só tem uma referência SUPERSEDED (nenhuma ACTIVE): nova ACTIVE é PERMITIDA — isto é o que torna SUPERSEDED utilizável, não decorativo", async () => {
    const { service, organization, referenceRepository } = await buildFixture();
    // Simula uma referência antiga já corrigida (SUPERSEDED) — G2 não
    // implementa o comando que faz essa transição (fora de escopo), mas
    // o repository/aggregate já suportam reconstituir esse estado, que é
    // o que uma fatia futura vai produzir.
    const supersededReference = OrganizationExternalReference.reconstitute({
      internalId: 1,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000050",
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099", // Organization A (diferente/antiga)
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 102,
      status: "SUPERSEDED",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });
    referenceRepository.stored.push(supersededReference);

    // Corrige o mapeamento: mesma legacy key, agora para Organization B
    // (a `organization` real da fixture) — deve SUCEDER, preservando a
    // linha SUPERSEDED como histórico.
    const result = await service.execute({
      organizationPublicId: organization.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 102,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.status).toBe("ACTIVE");
    // As DUAS linhas coexistem: a SUPERSEDED antiga (histórico) + a
    // ACTIVE nova (corrigida).
    expect(referenceRepository.stored).toHaveLength(2);
    const activeOnes = referenceRepository.stored.filter((r) => r.isActive());
    const supersededOnes = referenceRepository.stored.filter((r) => !r.isActive());
    expect(activeOnes).toHaveLength(1);
    expect(supersededOnes).toHaveLength(1);
    expect(activeOnes[0]?.getOrganizationPublicId()).toBe(organization.getPublicId().toString());
    expect(supersededOnes[0]?.getOrganizationPublicId()).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000099");
  });

  it("D) duas linhas históricas SUPERSEDED para a MESMA legacy key: permitidas (coexistem livremente, nunca competem entre si)", async () => {
    const { referenceRepository } = await buildFixture();
    const firstSuperseded = OrganizationExternalReference.reconstitute({
      internalId: 1,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000060",
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000091",
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 200,
      status: "SUPERSEDED",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-15T00:00:00Z")
    });
    const secondSuperseded = OrganizationExternalReference.reconstitute({
      internalId: 2,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000061",
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000092",
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 200,
      status: "SUPERSEDED",
      createdAt: new Date("2026-01-15T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });

    // Nenhuma exceção esperada aqui — inserir duas linhas SUPERSEDED
    // para a mesma legacy key nunca é um conflito (histórico).
    await expect(referenceRepository.insert(firstSuperseded)).resolves.toBeUndefined();
    await expect(referenceRepository.insert(secondSuperseded)).resolves.toBeUndefined();

    expect(referenceRepository.stored).toHaveLength(2);
    expect(referenceRepository.stored.every((r) => !r.isActive())).toBe(true);
  });

  it("E) existsActiveBySystemCodeEntityTypeAndLegacyId (lookup/idempotência) considera SOMENTE ACTIVE — uma referência SUPERSEDED não é encontrada por ela", async () => {
    const { organizationRepository, referenceRepository } = await buildFixture();
    const supersededReference = OrganizationExternalReference.reconstitute({
      internalId: 1,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000070",
      organizationPublicId: [...organizationRepository.stored.values()][0]!.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 300,
      status: "SUPERSEDED",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    referenceRepository.stored.push(supersededReference);

    const exists = await referenceRepository.existsActiveBySystemCodeEntityTypeAndLegacyId(
      SystemCode.create("PCTEC_PORTAL"),
      EntityType.create("clientes"),
      LegacyId.create(300)
    );

    expect(exists).toBe(false);
  });
});
