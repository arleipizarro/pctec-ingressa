import { describe, it, expect } from "vitest";
import { GrantApplicationAccessService } from "../application/GrantApplicationAccessService.js";
import type { ApplicationRepository } from "../domain/ApplicationRepository.js";
import type { ApplicationAccessRepository } from "../domain/ApplicationAccessRepository.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { Application } from "../domain/Application.js";
import { ApplicationAccess } from "../domain/ApplicationAccess.js";
import type { ApplicationCode } from "../domain/value-objects/ApplicationCode.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import type { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import {
  ApplicationNotFoundError,
  IdentityNotFoundForAccessError,
  ApplicationAccessActiveGrantConflictError
} from "../domain/errors/ApplicationErrors.js";

class InMemoryApplicationRepository implements ApplicationRepository {
  public readonly stored = new Map<string, Application>();
  public async findByPublicId(publicId: PublicId): Promise<Application | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async findByCode(code: ApplicationCode): Promise<Application | undefined> {
    return [...this.stored.values()].find((a) => a.getCode().equals(code));
  }
}

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
  }
  public async update(): Promise<void> {
    // não exercitado por GrantApplicationAccessService
  }
}

class InMemoryApplicationAccessRepository implements ApplicationAccessRepository {
  public async findByPublicId(): Promise<undefined> {
    return undefined;
  }

  public readonly stored: ApplicationAccess[] = [];
  /** Revogação não é exercida aqui; o double só satisfaz o contrato. */
  public async update(): Promise<void> {
    return undefined;
  }
  public async existsGrantedByApplicationAndProfile(applicationPublicId: string, accessProfile: string): Promise<boolean> {
    return this.stored.some(
      (a) => a.getApplicationPublicId() === applicationPublicId && a.getAccessProfile().toString() === accessProfile && a.isGranted()
    );
  }
  public async existsGrantedByIdentityAndApplication(
    identityPublicId: string,
    applicationPublicId: string
  ): Promise<boolean> {
    return this.stored.some(
      (a) =>
        a.getIdentityPublicId() === identityPublicId &&
        a.getApplicationPublicId() === applicationPublicId &&
        a.isGranted()
    );
  }

  public async existsGrantedByIdentityApplicationAndProfile(
    identityPublicId: string,
    applicationPublicId: string,
    accessProfile: string
  ): Promise<boolean> {
    return this.stored.some(
      (a) =>
        a.getIdentityPublicId() === identityPublicId &&
        a.getApplicationPublicId() === applicationPublicId &&
        a.getAccessProfile().toString() === accessProfile &&
        a.isGranted()
    );
  }
  public async insert(applicationAccess: ApplicationAccess): Promise<void> {
    this.stored.push(applicationAccess);
    applicationAccess.assignInternalIdFromPersistence(this.stored.length);
  }
  public async findByIdentityAndApplication(): Promise<ApplicationAccess | undefined> {
    return undefined;
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
const GRANTED_BY_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000077";

async function buildFixture() {
  const applicationRepository = new InMemoryApplicationRepository();
  const identityRepository = new InMemoryIdentityRepository();
  const applicationAccessRepository = new InMemoryApplicationAccessRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();
  const service = new GrantApplicationAccessService(
    new NoopUnitOfWork(),
    () => applicationRepository,
    () => identityRepository,
    () => applicationAccessRepository,
    () => auditEventRepository
  );

  const portalApplication = Application.reconstitute({
    internalId: 2,
    publicId: "3f9c1a2e-7d4b-4e5a-9c3f-000000000001",
    code: "PCTEC_PORTAL",
    name: "PCTEC Portal",
    status: "ACTIVE",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  applicationRepository.stored.set(portalApplication.getPublicId().toString(), portalApplication);

  const identity = Identity.create({
    type: "HUMAN",
    fullName: "Usuário de Teste do Portal",
    email: `portal-${Date.now()}-${Math.random()}@example.com`,
    actor: SYSTEM_ACTOR,
    correlationId: CORRELATION_ID
  });
  await identityRepository.insert(identity);

  return { applicationRepository, identityRepository, applicationAccessRepository, auditEventRepository, service, portalApplication, identity };
}

describe("GrantApplicationAccessService — 1. concessão bem-sucedida", () => {
  it("concede PCTEC_PORTAL/USER, persiste e grava application-access.granted", async () => {
    const { service, identity, applicationAccessRepository, auditEventRepository } = await buildFixture();

    const result = await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      applicationCode: "PCTEC_PORTAL",
      accessProfile: "USER",
      grantedByIdentityPublicId: GRANTED_BY_PUBLIC_ID
    });

    expect(result.applicationCode).toBe("PCTEC_PORTAL");
    expect(result.accessProfile).toBe("USER");
    expect(applicationAccessRepository.stored).toHaveLength(1);
    expect(auditEventRepository.events[0]?.eventType).toBe("application-access.granted");
  });
});

describe("GrantApplicationAccessService — 2. Application inexistente", () => {
  it("rejeita quando applicationCode não corresponde a nenhuma Application", async () => {
    const { service, identity } = await buildFixture();

    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        applicationCode: "PCTEC_INEXISTENTE",
        accessProfile: "USER",
        grantedByIdentityPublicId: GRANTED_BY_PUBLIC_ID
      })
    ).rejects.toThrow(ApplicationNotFoundError);
  });
});

describe("GrantApplicationAccessService — 3. Identity inexistente", () => {
  it("rejeita quando identityPublicId não existe", async () => {
    const { service } = await buildFixture();

    await expect(
      service.execute({
        identityPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000098",
        applicationCode: "PCTEC_PORTAL",
        accessProfile: "USER",
        grantedByIdentityPublicId: GRANTED_BY_PUBLIC_ID
      })
    ).rejects.toThrow(IdentityNotFoundForAccessError);
  });
});

describe("GrantApplicationAccessService — 4. duplicidade bloqueada", () => {
  it("rejeita conceder a MESMA combinação identity+application duas vezes", async () => {
    const { service, identity, applicationAccessRepository } = await buildFixture();

    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      applicationCode: "PCTEC_PORTAL",
      accessProfile: "USER",
      grantedByIdentityPublicId: GRANTED_BY_PUBLIC_ID
    });

    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        applicationCode: "PCTEC_PORTAL",
        accessProfile: "USER",
        grantedByIdentityPublicId: GRANTED_BY_PUBLIC_ID
      })
    ).rejects.toThrow(ApplicationAccessActiveGrantConflictError);

    expect(applicationAccessRepository.stored).toHaveLength(1);
  });

  it("rejeita um SEGUNDO perfil para a mesma identity+application — o perfil não está na chave", async () => {
    // Era o furo real: USER e depois ADMIN passavam pelas duas checagens
    // por profile e produziam dois acessos GRANTED simultâneos.
    const { service, identity, applicationAccessRepository } = await buildFixture();

    await service.execute({
      identityPublicId: identity.getPublicId().toString(),
      applicationCode: "PCTEC_PORTAL",
      accessProfile: "USER",
      grantedByIdentityPublicId: GRANTED_BY_PUBLIC_ID
    });

    await expect(
      service.execute({
        identityPublicId: identity.getPublicId().toString(),
        applicationCode: "PCTEC_PORTAL",
        accessProfile: "ADMIN",
        grantedByIdentityPublicId: GRANTED_BY_PUBLIC_ID
      })
    ).rejects.toThrow(ApplicationAccessActiveGrantConflictError);

    expect(applicationAccessRepository.stored).toHaveLength(1);
  });
});
