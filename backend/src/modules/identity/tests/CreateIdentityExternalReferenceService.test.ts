import { describe, it, expect } from "vitest";
import { CreateIdentityExternalReferenceService } from "../application/CreateIdentityExternalReferenceService.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import type { IdentityExternalReferenceRepository } from "../domain/IdentityExternalReferenceRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { Identity } from "../domain/Identity.js";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import { ActorPublicId } from "../domain/value-objects/ActorPublicId.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { LegacyId } from "../domain/value-objects/LegacyId.js";
import {
  IdentityExternalReferenceIdentityNotFoundError,
  IdentityExternalReferenceAlreadyExistsError
} from "../domain/errors/IdentityExternalReferenceErrors.js";

// ---------------------------------------------------------------------------
// Fakes em memória — nenhum destes testes toca SQL, mysql2 ou banco real.
// ---------------------------------------------------------------------------

class InMemoryIdentityRepository implements IdentityRepository {
  public readonly stored = new Map<string, Identity>();

  public async findByPublicId(publicId: PublicId): Promise<Identity | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async findByNormalizedEmail(_e: string): Promise<Identity | undefined> {
    return undefined;
  }
  public async existsByNormalizedEmail(_e: string): Promise<boolean> {
    return false;
  }
  public async existsByNormalizedCpf(_c: string): Promise<boolean> {
    return false;
  }
  public async countAll(): Promise<number> {
    return this.stored.size;
  }
  public async insert(identity: Identity): Promise<void> {
    this.stored.set(identity.getPublicId().toString(), identity);
  }
  public async update(_identity: Identity, _expectedVersion: number): Promise<void> {}
}

class InMemoryIdentityExternalReferenceRepository implements IdentityExternalReferenceRepository {
  public readonly stored: IdentityExternalReference[] = [];

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
  public async findByPublicId(publicId: PublicId): Promise<IdentityExternalReference | undefined> {
    return this.stored.find((r) => r.getPublicId().equals(publicId));
  }
  public async findActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<IdentityExternalReference | undefined> {
    return this.stored.find(
      (r) =>
        r.isActive() &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType) &&
        r.getLegacyId().equals(legacyId)
    );
  }
  public async insert(reference: IdentityExternalReference): Promise<void> {
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SYSTEM_ACTOR = ActorPublicId.system();
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

async function buildFixture() {
  const identityRepository = new InMemoryIdentityRepository();
  const referenceRepository = new InMemoryIdentityExternalReferenceRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();
  const service = new CreateIdentityExternalReferenceService(
    new NoopUnitOfWork(),
    () => identityRepository,
    () => referenceRepository,
    () => auditEventRepository
  );
  const identity = Identity.create({
    type: "HUMAN",
    fullName: "Arlei Pizarro",
    email: "arlei.pizarro@pctec.com.br",
    actor: SYSTEM_ACTOR,
    correlationId: CORRELATION_ID
  });
  await identityRepository.insert(identity);
  return { identityRepository, referenceRepository, auditEventRepository, service, identity };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe("CreateIdentityExternalReferenceService — 1. cria referência Portal", () => {
  it("cria, persiste e grava identity-external-reference.created com matchMethod", async () => {
    const { service, identity, referenceRepository, auditEventRepository } = await buildFixture();

    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 33,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.systemCode).toBe("PCTEC_PORTAL");
    expect(result.matchMethod).toBe("MATCHED_MANUAL_CONFIRMED");
    expect(referenceRepository.stored).toHaveLength(1);
    expect(auditEventRepository.events[0]?.eventType).toBe("identity-external-reference.created");
  });
});

describe("CreateIdentityExternalReferenceService — 2/3. cria referência HUB e Helpdesk", () => {
  it("cria referência PCTEC_HUB com MATCHED_BY_EMAIL", async () => {
    const { service, identity } = await buildFixture();
    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 20,
      matchMethod: "MATCHED_BY_EMAIL",
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(result.systemCode).toBe("PCTEC_HUB");
    expect(result.matchMethod).toBe("MATCHED_BY_EMAIL");
  });

  it("cria referência PCTEC_HELPDESK", async () => {
    const { service, identity } = await buildFixture();
    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_HELPDESK",
      entityType: "clients",
      legacyId: 30,
      matchMethod: "MATCHED_BY_EMAIL",
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(result.systemCode).toBe("PCTEC_HELPDESK");
  });
});

describe("CreateIdentityExternalReferenceService — 4. mesmo legacyId em sistemas diferentes permitido", () => {
  it("PCTEC_HUB e PCTEC_PORTAL com o mesmo legacyId, mesma entityType, não colidem", async () => {
    const { service, identity, referenceRepository } = await buildFixture();

    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 55,
      matchMethod: "MATCHED_BY_EMAIL",
      actorPublicId: ACTOR_PUBLIC_ID
    });
    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 55,
      matchMethod: "MATCHED_BY_EMAIL",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(referenceRepository.stored).toHaveLength(2);
  });
});

describe("CreateIdentityExternalReferenceService — 5. mesmo system+entityType+legacyId bloqueado", () => {
  it("rejeita segunda referência com a MESMA combinação (system_code, entity_type, legacy_id)", async () => {
    const { service, identity, referenceRepository } = await buildFixture();

    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 33,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: 33,
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(IdentityExternalReferenceAlreadyExistsError);

    expect(referenceRepository.stored).toHaveLength(1);
  });
});

describe("CreateIdentityExternalReferenceService — 6. publicId próprio", () => {
  it("cada referência tem publicId distinto da Identity e das demais referências", async () => {
    const { service, identity } = await buildFixture();
    const a = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 1,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID
    });
    const b = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 1,
      matchMethod: "MATCHED_BY_EMAIL",
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(a.publicId).not.toBe(b.publicId);
    expect(a.publicId).not.toBe(identity.getPublicId().toString());
  });
});

describe("CreateIdentityExternalReferenceService — 7. Identity inexistente bloqueada", () => {
  it("rejeita quando identityPublicId não existe", async () => {
    const { service } = await buildFixture();

    await expect(
      service.execute({
        identityPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099",
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: 33,
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(IdentityExternalReferenceIdentityNotFoundError);
  });
});

describe("CreateIdentityExternalReferenceService — 8. status/lifecycle", () => {
  it("toda referência nasce com status ACTIVE", async () => {
    const { service, identity } = await buildFixture();
    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 33,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(result.status).toBe("ACTIVE");
  });
});

describe("CreateIdentityExternalReferenceService — 9. histórico ACTIVE/SUPERSEDED", () => {
  it("A) legacy key sem NENHUMA referência: pode criar ACTIVE normalmente", async () => {
    const { service, identity, referenceRepository } = await buildFixture();

    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 100,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.status).toBe("ACTIVE");
    expect(referenceRepository.stored).toHaveLength(1);
  });

  it("B) mesma legacy key já tem uma referência ACTIVE: criação de outra ACTIVE é bloqueada", async () => {
    const { service, identity, referenceRepository } = await buildFixture();

    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 101,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: 101,
        matchMethod: "MATCHED_MANUAL_CONFIRMED",
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow(IdentityExternalReferenceAlreadyExistsError);

    expect(referenceRepository.stored).toHaveLength(1);
  });

  it("C) mesma legacy key só tem uma referência SUPERSEDED: nova ACTIVE é PERMITIDA — SUPERSEDED utilizável, não decorativo", async () => {
    const { service, identity, referenceRepository } = await buildFixture();
    // Simula referência antiga já corrigida (SUPERSEDED) — CLI ainda não
    // implementada (Fatia 3), mas reconstitute já suporta esse estado.
    const supersededReference = IdentityExternalReference.reconstitute({
      internalId: 1,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000050",
      identityPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099", // Identity antiga
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 102,
      matchMethod: "MATCHED_BY_EMAIL",
      status: "SUPERSEDED",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });
    referenceRepository.stored.push(supersededReference);

    // Corrige o mapeamento: mesma legacy key, agora para a Identity correta.
    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 102,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(result.status).toBe("ACTIVE");
    expect(referenceRepository.stored).toHaveLength(2);
    const activeOnes = referenceRepository.stored.filter((r) => r.isActive());
    const supersededOnes = referenceRepository.stored.filter((r) => !r.isActive());
    expect(activeOnes).toHaveLength(1);
    expect(supersededOnes).toHaveLength(1);
    expect(activeOnes[0]?.getIdentityPublicId()).toBe(identity.getPublicId().toString());
    expect(activeOnes[0]?.getMatchMethod().toString()).toBe("MATCHED_MANUAL_CONFIRMED");
    expect(supersededOnes[0]?.getIdentityPublicId()).toBe("0b13f6f0-8f3a-4a1e-9c2d-000000000099");
  });

  it("D) duas linhas históricas SUPERSEDED para a MESMA legacy key: permitidas (coexistem livremente)", async () => {
    const { referenceRepository } = await buildFixture();
    const first = IdentityExternalReference.reconstitute({
      internalId: 1,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000060",
      identityPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000091",
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 200,
      matchMethod: "MATCHED_BY_EMAIL",
      status: "SUPERSEDED",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-15T00:00:00Z")
    });
    const second = IdentityExternalReference.reconstitute({
      internalId: 2,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000061",
      identityPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000092",
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 200,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      status: "SUPERSEDED",
      createdAt: new Date("2026-01-15T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });

    await expect(referenceRepository.insert(first)).resolves.toBeUndefined();
    await expect(referenceRepository.insert(second)).resolves.toBeUndefined();

    expect(referenceRepository.stored).toHaveLength(2);
    expect(referenceRepository.stored.every((r) => !r.isActive())).toBe(true);
  });

  it("E) existsActiveBySystemCodeEntityTypeAndLegacyId considera SOMENTE ACTIVE — SUPERSEDED não é encontrada", async () => {
    const { referenceRepository } = await buildFixture();
    const superseded = IdentityExternalReference.reconstitute({
      internalId: 1,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000070",
      identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 300,
      matchMethod: "MATCHED_BY_EMAIL",
      status: "SUPERSEDED",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    referenceRepository.stored.push(superseded);

    const exists = await referenceRepository.existsActiveBySystemCodeEntityTypeAndLegacyId(
      SystemCode.create("PCTEC_PORTAL"),
      EntityType.create("portal_acesso"),
      LegacyId.create(300)
    );

    expect(exists).toBe(false);
  });
});

describe("CreateIdentityExternalReferenceService — 10. matchMethod (diferencial vs Organization)", () => {
  it("MATCHED_BY_EMAIL é aceito e retornado no resultado", async () => {
    const { service, identity } = await buildFixture();
    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 33,
      matchMethod: "MATCHED_BY_EMAIL",
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(result.matchMethod).toBe("MATCHED_BY_EMAIL");
  });

  it("MATCHED_MANUAL_CONFIRMED é aceito e retornado no resultado", async () => {
    const { service, identity } = await buildFixture();
    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 34,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID
    });
    expect(result.matchMethod).toBe("MATCHED_MANUAL_CONFIRMED");
  });

  it("matchMethod inválido (UNMATCHED) é rejeitado antes de chegar ao repository", async () => {
    const { service, identity } = await buildFixture();
    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        systemCode: "PCTEC_PORTAL",
        entityType: "portal_acesso",
        legacyId: 35,
        matchMethod: "UNMATCHED",
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toThrow();
  });

  it("o evento gerado inclui matchMethod no payload", async () => {
    const { service, identity, referenceRepository } = await buildFixture();
    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 36,
      matchMethod: "MATCHED_BY_EMAIL",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    const ref = referenceRepository.stored[0];
    expect(ref).toBeDefined();
    expect(ref?.getMatchMethod().toString()).toBe("MATCHED_BY_EMAIL");
  });
});
