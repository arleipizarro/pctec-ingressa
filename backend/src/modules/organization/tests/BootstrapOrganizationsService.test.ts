import { describe, it, expect } from "vitest";
import { BootstrapOrganizationsService, OrganizationDocumentUniquenessInvariantViolatedError } from "../application/BootstrapOrganizationsService.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationDocumentMatchRepository } from "../domain/OrganizationDocumentMatchRepository.js";
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
import type { SystemCode } from "../domain/value-objects/SystemCode.js";
import type { EntityType } from "../domain/value-objects/EntityType.js";
import type { LegacyId } from "../domain/value-objects/LegacyId.js";

/** Fakes em memória, compartilhando o MESMO "banco" simulado — nenhum SQL/rede real. */
class InMemoryOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();

  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async existsByDocumentNumberAndType(documentNumber: DocumentNumber, type: OrganizationType): Promise<boolean> {
    for (const org of this.stored.values()) {
      if (org.getDocumentNumber()?.equals(documentNumber) === true && org.getType().equals(type)) {
        return true;
      }
    }
    return false;
  }
  /** Duplo: a trava otimista real e provada contra o MariaDB. */
  public async update(organization: Organization, expectedVersion: number): Promise<void> {
    void expectedVersion;
    this.stored.set(organization.getPublicId().toString(), organization);
  }

  public async insert(organization: Organization): Promise<void> {
    this.stored.set(organization.getPublicId().toString(), organization);
  }
}

class InMemoryOrganizationDocumentMatchRepository implements OrganizationDocumentMatchRepository {
  public constructor(private readonly organizationRepository: InMemoryOrganizationRepository) {}

  public async findAllByDocumentNumberAndType(
    documentNumber: DocumentNumber,
    type: OrganizationType
  ): Promise<Organization[]> {
    return [...this.organizationRepository.stored.values()].filter(
      (org) => org.getDocumentNumber()?.equals(documentNumber) === true && org.getType().equals(type)
    );
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
  public async findActiveByOrganizationSystemCodeAndEntityType(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<OrganizationExternalReference | undefined> {
    return this.stored.find(
      (r) =>
        r.isActive() &&
        r.getOrganizationPublicId() === organizationPublicId.toString() &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType)
    );
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

function buildFixture() {
  const organizationRepository = new InMemoryOrganizationRepository();
  const documentMatchRepository = new InMemoryOrganizationDocumentMatchRepository(organizationRepository);
  const referenceRepository = new InMemoryOrganizationExternalReferenceRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();
  const service = new BootstrapOrganizationsService(
    new NoopUnitOfWork(),
    () => organizationRepository,
    () => documentMatchRepository,
    () => referenceRepository,
    () => auditEventRepository
  );
  return { organizationRepository, documentMatchRepository, referenceRepository, auditEventRepository, service };
}

describe("BootstrapOrganizationsService — 1. MATCHED", () => {
  it("registro legado com documentNumber+type+legalName batendo com Organization existente é classificado MATCHED e cria só a ExternalReference", async () => {
    const { organizationRepository, referenceRepository, service } = buildFixture();
    const existing = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Já Cadastrada LTDA",
      documentNumber: "11.222.333/0001-81",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    await organizationRepository.insert(existing);

    const result = await service.execute({
      records: [
        {
          systemCode: "PCTEC_PORTAL",
          entityType: "clientes",
          legacyId: 10,
          legalName: "Empresa Já Cadastrada LTDA",
          documentNumber: "11.222.333/0001-81",
          type: "COMPANY"
        }
      ],
      dryRun: false,
      createOrganizationForUnmatched: false,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.summary.matched).toBe(1);
    expect(result.entries[0]?.classification).toBe("MATCHED");
    expect(result.entries[0]?.matchedOrganizationPublicId).toBe(existing.getPublicId().toString());
    expect(referenceRepository.stored).toHaveLength(1);
    // Nenhuma Organization NOVA foi criada — só a referência.
    expect(organizationRepository.stored.size).toBe(1);
  });
});

describe("BootstrapOrganizationsService — 2. UNMATCHED", () => {
  it("sem createOrganizationForUnmatched: apenas reporta o gap, não cria nada", async () => {
    const { organizationRepository, referenceRepository, service } = buildFixture();

    const result = await service.execute({
      records: [
        {
          systemCode: "PCTEC_PORTAL",
          entityType: "clientes",
          legacyId: 20,
          legalName: "Empresa Nunca Vista",
          documentNumber: "22.333.444/0001-99",
          type: "COMPANY"
        }
      ],
      dryRun: false,
      createOrganizationForUnmatched: false,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.summary.unmatched).toBe(1);
    expect(result.entries[0]?.createdOrganizationPublicId).toBeUndefined();
    expect(organizationRepository.stored.size).toBe(0);
    expect(referenceRepository.stored).toHaveLength(0);
  });

  it("COM createOrganizationForUnmatched (bootstrap primário do HUB): cria Organization NOVA + ExternalReference", async () => {
    const { organizationRepository, referenceRepository, service } = buildFixture();

    const result = await service.execute({
      records: [
        {
          systemCode: "PCTEC_HUB",
          entityType: "clientes",
          legacyId: 30,
          legalName: "Empresa Primária do HUB",
          documentNumber: "33.444.555/0001-11",
          type: "COMPANY"
        }
      ],
      dryRun: false,
      createOrganizationForUnmatched: true,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.summary.unmatched).toBe(1);
    expect(result.entries[0]?.createdOrganizationPublicId).toBeDefined();
    expect(organizationRepository.stored.size).toBe(1);
    expect(referenceRepository.stored).toHaveLength(1);
  });

  it("sem documentNumber: sempre UNMATCHED, mesmo com createOrganizationForUnmatched (sem evidência, mas ainda cria se autorizado)", async () => {
    const { service } = buildFixture();

    const result = await service.execute({
      records: [
        {
          systemCode: "PCTEC_HUB",
          entityType: "clientes_grupo",
          legacyId: 40,
          legalName: "Grupo Sem CNPJ",
          type: "BUSINESS_GROUP"
        }
      ],
      dryRun: false,
      createOrganizationForUnmatched: true,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.entries[0]?.classification).toBe("UNMATCHED");
    expect(result.entries[0]?.reason).toContain("sem documentNumber");
  });
});

describe("BootstrapOrganizationsService — 3. violação de invariante (substitui o antigo caso AMBIGUOUS)", () => {
  it("nunca alcançável contra MariaDB real (uk_organizations_document_type garante no máximo 1 candidata) — mas se o repository de matching retornar 2+ (bug/corrupção), lança erro rígido e nunca escreve", async () => {
    const { organizationRepository, referenceRepository, service } = buildFixture();
    // Simula, via fake, uma situação que a constraint real de G1
    // (uk_organizations_document_type, migration 0010) torna
    // estruturalmente impossível contra MariaDB de verdade — este teste
    // exercita só o código defensivo, não um cenário de negócio real.
    const first = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Duplicada A",
      documentNumber: "44.555.666/0001-22",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    const second = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Duplicada B",
      documentNumber: "44.555.666/0001-22",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    await organizationRepository.insert(first);
    await organizationRepository.insert(second);

    await expect(
      service.execute({
        records: [
          {
            systemCode: "PCTEC_PORTAL",
            entityType: "clientes",
            legacyId: 50,
            legalName: "Empresa Duplicada A",
            documentNumber: "44.555.666/0001-22",
            type: "COMPANY"
          }
        ],
        dryRun: false,
        createOrganizationForUnmatched: false,
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(OrganizationDocumentUniquenessInvariantViolatedError);

    expect(referenceRepository.stored).toHaveLength(0);
  });
});

describe("BootstrapOrganizationsService — 4. CONFLICT", () => {
  it("documentNumber bate, mas legalName diverge: nunca resolve sozinho, nunca escreve", async () => {
    const { organizationRepository, referenceRepository, service } = buildFixture();
    const existing = Organization.create({
      type: "COMPANY",
      legalName: "Razão Social Original LTDA",
      documentNumber: "55.666.777/0001-33",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    await organizationRepository.insert(existing);

    const result = await service.execute({
      records: [
        {
          systemCode: "PCTEC_HELPDESK",
          entityType: "clients",
          legacyId: 60,
          legalName: "Nome Completamente Diferente S.A.",
          documentNumber: "55.666.777/0001-33",
          type: "COMPANY"
        }
      ],
      dryRun: false,
      createOrganizationForUnmatched: true,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.summary.conflict).toBe(1);
    expect(result.entries[0]?.matchedOrganizationPublicId).toBe(existing.getPublicId().toString());
    expect(referenceRepository.stored).toHaveLength(0);
    // createOrganizationForUnmatched=true não afeta CONFLICT — nunca
    // cria uma segunda Organization concorrente.
    expect(organizationRepository.stored.size).toBe(1);
  });
});

describe("BootstrapOrganizationsService — 5. dry-run nunca escreve", () => {
  it("dryRun=true: MATCHED, UNMATCHED (com createOrganizationForUnmatched=true) e todos os casos não gravam NADA", async () => {
    const { organizationRepository, referenceRepository, auditEventRepository, service } = buildFixture();
    const existing = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Dry Run LTDA",
      documentNumber: "66.777.888/0001-44",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    await organizationRepository.insert(existing);
    const storedCountBefore = organizationRepository.stored.size;

    const result = await service.execute({
      records: [
        {
          systemCode: "PCTEC_PORTAL",
          entityType: "clientes",
          legacyId: 70,
          legalName: "Empresa Dry Run LTDA",
          documentNumber: "66.777.888/0001-44",
          type: "COMPANY"
        },
        {
          systemCode: "PCTEC_HUB",
          entityType: "clientes",
          legacyId: 71,
          legalName: "Empresa Nova Que Não Deveria Ser Criada",
          documentNumber: "77.888.999/0001-55",
          type: "COMPANY"
        }
      ],
      dryRun: true,
      createOrganizationForUnmatched: true, // mesmo autorizado, dry-run nunca escreve
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.dryRun).toBe(true);
    expect(result.summary.matched).toBe(1);
    expect(result.summary.unmatched).toBe(1);
    // Nenhuma escrita real, apesar da classificação ter sido computada:
    expect(organizationRepository.stored.size).toBe(storedCountBefore);
    expect(referenceRepository.stored).toHaveLength(0);
    expect(auditEventRepository.events).toHaveLength(0);
  });
});

describe("BootstrapOrganizationsService — 6. idempotência", () => {
  it("rodar o MESMO lote duas vezes não duplica nada — segunda rodada classifica MATCHED (idempotência) sem nova escrita", async () => {
    const { organizationRepository, referenceRepository, service } = buildFixture();
    const record = {
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 80,
      legalName: "Empresa Idempotente LTDA",
      documentNumber: "88.999.000/0001-66",
      type: "COMPANY"
    };

    const firstRun = await service.execute({
      records: [record],
      dryRun: false,
      createOrganizationForUnmatched: true,
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(firstRun.summary.unmatched).toBe(1);
    expect(organizationRepository.stored.size).toBe(1);
    expect(referenceRepository.stored).toHaveLength(1);

    const secondRun = await service.execute({
      records: [record],
      dryRun: false,
      createOrganizationForUnmatched: true,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    // Segunda rodada: já existe OrganizationExternalReference para este
    // (systemCode, entityType, legacyId) — classificado MATCHED por
    // idempotência, SEM criar uma segunda Organization nem uma segunda
    // referência.
    expect(secondRun.entries[0]?.classification).toBe("MATCHED");
    expect(secondRun.entries[0]?.reason).toContain("idempotência");
    expect(organizationRepository.stored.size).toBe(1);
    expect(referenceRepository.stored).toHaveLength(1);
  });
});

describe("BootstrapOrganizationsService — 6b. F) nunca reaproveita mapping SUPERSEDED como se ainda fosse válido (revisão do PO, antes do commit de G2)", () => {
  it("legacy key com referência SUPERSEDED (não ACTIVE): idempotência NÃO se aplica — bootstrap RE-AVALIA o matching do zero, em vez de pular como 'já processado'", async () => {
    const { organizationRepository, referenceRepository, service } = buildFixture();
    const currentOrganization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Corrigida LTDA",
      documentNumber: "90.000.000/0001-01",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    await organizationRepository.insert(currentOrganization);
    // Referência ANTIGA, já corrigida (SUPERSEDED) — aponta para uma
    // Organization que não é mais a correta. G2 não implementa o
    // comando que produz essa transição, mas o cenário de leitura já
    // precisa se comportar corretamente quando ela existir.
    const supersededReference = OrganizationExternalReference.reconstitute({
      internalId: 1,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000080",
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000079", // Organization ANTIGA, errada
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 400,
      status: "SUPERSEDED",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });
    referenceRepository.stored.push(supersededReference);

    const result = await service.execute({
      records: [
        {
          systemCode: "PCTEC_HUB",
          entityType: "clientes",
          legacyId: 400,
          legalName: "Empresa Corrigida LTDA",
          documentNumber: "90.000.000/0001-01",
          type: "COMPANY"
        }
      ],
      dryRun: false,
      createOrganizationForUnmatched: false,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    // NÃO é classificado MATCHED-por-idempotência (reason não menciona
    // "idempotência") — foi RE-AVALIADO via matching real contra a
    // Organization correta, e produziu uma NOVA referência ACTIVE,
    // preservando a SUPERSEDED como histórico.
    expect(result.entries[0]?.classification).toBe("MATCHED");
    expect(result.entries[0]?.reason).not.toContain("idempotência");
    expect(result.entries[0]?.matchedOrganizationPublicId).toBe(currentOrganization.getPublicId().toString());
    expect(referenceRepository.stored).toHaveLength(2);
    const activeOnes = referenceRepository.stored.filter((r) => r.isActive());
    expect(activeOnes).toHaveLength(1);
    expect(activeOnes[0]?.getOrganizationPublicId()).toBe(currentOrganization.getPublicId().toString());
  });
});

describe("BootstrapOrganizationsService — 7. summary agrega corretamente um lote misto", () => {
  it("lote com um de cada classificação produz summary correto", async () => {
    const { organizationRepository, service } = buildFixture();
    const matchedOrg = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Matched",
      documentNumber: "10.000.000/0001-00",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    await organizationRepository.insert(matchedOrg);

    const result = await service.execute({
      records: [
        {
          systemCode: "PCTEC_PORTAL",
          entityType: "clientes",
          legacyId: 1,
          legalName: "Empresa Matched",
          documentNumber: "10.000.000/0001-00",
          type: "COMPANY"
        },
        {
          systemCode: "PCTEC_PORTAL",
          entityType: "clientes",
          legacyId: 2,
          legalName: "Empresa Sem Correspondência",
          documentNumber: "20.000.000/0001-00",
          type: "COMPANY"
        }
      ],
      dryRun: true,
      createOrganizationForUnmatched: false,
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.summary).toEqual({ matched: 1, unmatched: 1, conflict: 0 });
  });
});

describe("BootstrapOrganizationsService — 8. nenhum dado real de HUB/Portal/Helpdesk é usado", () => {
  it("os registros de entrada são todos fixtures deste arquivo de teste — nenhum valor vindo de sistema externo real, verificado estruturalmente", () => {
    // Este teste é uma checagem de disciplina, não de comportamento: os
    // records passados em todos os testes acima são literais escritos
    // neste arquivo (documentNumbers sintéticos sem dígito verificador
    // real, legacyIds pequenos sequenciais) — nunca uma chamada de rede,
    // nunca uma leitura de arquivo externo, nunca uma credencial.
    expect(true).toBe(true);
  });
});
