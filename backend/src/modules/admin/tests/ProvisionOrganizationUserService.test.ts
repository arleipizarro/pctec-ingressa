import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { ProvisionOrganizationUserService } from "../application/ProvisionOrganizationUserService.js";
import { CreateIdentityService } from "../../identity/application/CreateIdentityService.js";
import { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import { Identity } from "../../identity/domain/Identity.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { PublicId as IdentityPublicIdType } from "../../identity/domain/value-objects/PublicId.js";
import { Organization } from "../../organization/domain/Organization.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import type { PublicId as OrganizationPublicIdType } from "../../organization/domain/value-objects/PublicId.js";
import type { OrganizationType } from "../../organization/domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../../organization/domain/value-objects/DocumentNumber.js";
import type { Membership } from "../../organization/domain/Membership.js";
import type { MembershipRepository } from "../../organization/domain/MembershipRepository.js";
import type { MembershipProfile } from "../../organization/domain/value-objects/MembershipProfile.js";
import { Application } from "../../application/domain/Application.js";
import type { ApplicationRepository } from "../../application/domain/ApplicationRepository.js";
import type { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import type { PublicId as ApplicationPublicIdType } from "../../application/domain/value-objects/PublicId.js";
import type { ApplicationAccess } from "../../application/domain/ApplicationAccess.js";
import type { ApplicationAccessRepository } from "../../application/domain/ApplicationAccessRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { IdentityEmailAlreadyExistsError } from "../../identity/domain/errors/IdentityErrors.js";
import { MembershipOrganizationNotActiveError } from "../../organization/domain/errors/MembershipErrors.js";
import { ApplicationNotFoundError } from "../../application/domain/errors/ApplicationErrors.js";
import {
  UserProvisioningApplicationNotActiveError,
  UserProvisioningApplicationsRequiredError,
  UserProvisioningScopeNotAllowedForCompanyError
} from "../application/errors/UserProvisioningErrors.js";

const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

class FakeIdentityRepository implements IdentityRepository {
  public readonly stored = new Map<string, Identity>();
  public falharNoInsert = false;

  public async findByPublicId(publicId: IdentityPublicIdType): Promise<Identity | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async findByNormalizedEmail(normalizedEmail: string): Promise<Identity | undefined> {
    return [...this.stored.values()].find((i) => i.getEmail().normalized() === normalizedEmail);
  }
  public async existsByNormalizedEmail(normalizedEmail: string): Promise<boolean> {
    return (await this.findByNormalizedEmail(normalizedEmail)) !== undefined;
  }
  public async existsByNormalizedCpf(_normalizedCpf: string): Promise<boolean> {
    return false;
  }
  public async countAll(): Promise<number> {
    return this.stored.size;
  }
  public async insert(identity: Identity): Promise<void> {
    if (this.falharNoInsert) {
      throw new Error("falha simulada ao inserir Identity");
    }
    identity.assignInternalIdFromPersistence(this.stored.size + 1);
    this.stored.set(identity.getPublicId().toString(), identity);
  }
  public async update(identity: Identity, _expectedVersion: number): Promise<void> {
    this.stored.set(identity.getPublicId().toString(), identity);
  }
}

class FakeOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();
  public async findByPublicId(publicId: OrganizationPublicIdType): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async existsByDocumentNumberAndType(
    _d: DocumentNumber,
    _t: OrganizationType
  ): Promise<boolean> {
    return false;
  }
  public async insert(organization: Organization): Promise<void> {
    this.stored.set(organization.getPublicId().toString(), organization);
  }
  public async update(_o: Organization, _v: number): Promise<void> {}
}

class FakeMembershipRepository implements MembershipRepository {
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
    return this.findAllByIdentityPublicId(identityPublicId);
  }
  public async findByPublicId(publicId: OrganizationPublicIdType): Promise<Membership | undefined> {
    return this.stored.find((m) => m.getPublicId().toString() === publicId.toString());
  }
  public async insert(membership: Membership): Promise<void> {
    this.stored.push(membership);
  }
  public async update(_m: Membership, _v: number): Promise<void> {}
}

class FakeApplicationRepository implements ApplicationRepository {
  public readonly stored: Application[] = [];
  public async findByPublicId(publicId: ApplicationPublicIdType): Promise<Application | undefined> {
    return this.stored.find((a) => a.getPublicId().toString() === publicId.toString());
  }
  public async findByCode(code: ApplicationCode): Promise<Application | undefined> {
    return this.stored.find((a) => a.getCode().toString() === code.toString());
  }
}

class FakeApplicationAccessRepository implements ApplicationAccessRepository {
  public readonly stored: ApplicationAccess[] = [];
  public falharNoSegundoInsert = false;
  private inseridos = 0;

  public async existsGrantedByApplicationAndProfile(): Promise<boolean> {
    return false;
  }
  public async existsGrantedByIdentityApplicationAndProfile(): Promise<boolean> {
    return false;
  }
  public async existsGrantedByIdentityAndApplication(
    identityPublicId: string,
    applicationPublicId: string
  ): Promise<boolean> {
    return this.stored.some(
      (a) =>
        a.getIdentityPublicId() === identityPublicId &&
        a.getApplicationPublicId() === applicationPublicId &&
        a.getStatus() === "GRANTED"
    );
  }
  public async findByPublicId(publicId: string): Promise<ApplicationAccess | undefined> {
    return this.stored.find((a) => a.getPublicId().toString() === publicId);
  }
  public async insert(applicationAccess: ApplicationAccess): Promise<void> {
    this.inseridos += 1;
    if (this.falharNoSegundoInsert && this.inseridos === 2) {
      throw new Error("falha simulada ao conceder o segundo acesso");
    }
    this.stored.push(applicationAccess);
  }
  public async update(_a: ApplicationAccess, _v: number): Promise<void> {}
  public async findByIdentityAndApplication(
    identityPublicId: string,
    applicationPublicId: string
  ): Promise<ApplicationAccess | undefined> {
    return this.stored.find(
      (a) => a.getIdentityPublicId() === identityPublicId && a.getApplicationPublicId() === applicationPublicId
    );
  }
}

class FakeAuditEventRepository implements AuditEventRepository {
  public readonly events: AuditEvent[] = [];
  public async insert(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    this.events.push(...events);
  }
  public tipos(): string[] {
    return this.events.map((e) => e.eventType);
  }
}

/** Restaura os stores quando o trabalho lança — modela BEGIN/ROLLBACK. */
class RollbackAwareUnitOfWork implements UnitOfWork {
  public constructor(private readonly stores: { restaurar: () => () => void }) {}
  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    const desfazer = this.stores.restaurar();
    const conexao: Queryable = {
      execute: async () => {
        throw new Error("Este teste não deveria executar SQL real.");
      }
    };
    try {
      return await work(conexao);
    } catch (erro) {
      desfazer();
      throw erro;
    }
  }
}

const COMPANY = randomUUID();
const GRUPO = randomUUID();
const COMPANY_INATIVA = randomUUID();

function montar() {
  const identidades = new FakeIdentityRepository();
  const organizacoes = new FakeOrganizationRepository();
  const vinculos = new FakeMembershipRepository();
  const aplicacoes = new FakeApplicationRepository();
  const acessos = new FakeApplicationAccessRepository();
  const auditoria = new FakeAuditEventRepository();

  organizacoes.stored.set(
    COMPANY,
    Organization.reconstitute({
      internalId: 1, publicId: COMPANY, type: "COMPANY", legalName: "Empresa Alvo Ltda",
      status: "ACTIVE", version: 1, createdAt: new Date(), updatedAt: new Date()
    })
  );
  organizacoes.stored.set(
    GRUPO,
    Organization.reconstitute({
      internalId: 2, publicId: GRUPO, type: "BUSINESS_GROUP", legalName: "Grupo Alvo",
      status: "ACTIVE", version: 1, createdAt: new Date(), updatedAt: new Date()
    })
  );
  organizacoes.stored.set(
    COMPANY_INATIVA,
    Organization.reconstitute({
      internalId: 3, publicId: COMPANY_INATIVA, type: "COMPANY", legalName: "Empresa Desativada",
      status: "INACTIVE", version: 1, createdAt: new Date(), updatedAt: new Date()
    })
  );

  aplicacoes.stored.push(
    Application.reconstitute({
      internalId: 1, publicId: randomUUID(), code: "PCTEC_PORTAL", name: "Portal",
      status: "ACTIVE", version: 1, createdAt: new Date(), updatedAt: new Date()
    }),
    Application.reconstitute({
      internalId: 2, publicId: randomUUID(), code: "PCTEC_HELPDESK", name: "Helpdesk",
      status: "ACTIVE", version: 1, createdAt: new Date(), updatedAt: new Date()
    }),
    Application.reconstitute({
      internalId: 3, publicId: randomUUID(), code: "PCTEC_CLAIM", name: "Claim",
      status: "INACTIVE", version: 1, createdAt: new Date(), updatedAt: new Date()
    })
  );

  const snapshot = () => {
    const ids = new Map(identidades.stored);
    const vs = [...vinculos.stored];
    const as = [...acessos.stored];
    const es = [...auditoria.events];
    return () => {
      identidades.stored.clear();
      for (const [k, v] of ids) identidades.stored.set(k, v);
      vinculos.stored.length = 0;
      vinculos.stored.push(...vs);
      acessos.stored.length = 0;
      acessos.stored.push(...as);
      auditoria.events.length = 0;
      auditoria.events.push(...es);
    };
  };

  const service = new ProvisionOrganizationUserService({
    unitOfWork: new RollbackAwareUnitOfWork({ restaurar: snapshot }),
    organizationRepositoryFactory: () => organizacoes,
    identityRepositoryFactory: () => identidades,
    applicationRepositoryFactory: () => aplicacoes,
    auditEventRepositoryFactory: () => auditoria,
    createIdentityServiceFactory: (uow) => new CreateIdentityService(uow, () => identidades, () => auditoria),
    createMembershipServiceFactory: (uow) =>
      new CreateMembershipService(uow, () => identidades, () => organizacoes, () => vinculos, () => auditoria),
    grantApplicationAccessServiceFactory: (uow) =>
      new GrantApplicationAccessService(uow, () => aplicacoes, () => identidades, () => acessos, () => auditoria)
  });

  return { identidades, organizacoes, vinculos, aplicacoes, acessos, auditoria, service };
}

const PEDIDO_VALIDO = {
  organizationPublicId: COMPANY,
  fullName: "Maria Souza",
  email: "maria.souza@example.invalid",
  membershipProfile: "CUSTOMER",
  membershipScope: "ORGANIZATION_ONLY",
  applicationCodes: ["PCTEC_PORTAL"],
  actorPublicId: ADMIN
};

describe("ProvisionOrganizationUserService — caminho feliz", () => {
  it("deixa a Identity ACTIVE, com login DESABILITADO e SEM credencial", async () => {
    const { identidades, service } = montar();
    const resultado = await service.execute(PEDIDO_VALIDO);

    expect(resultado.status).toBe("ACTIVE");
    expect(resultado.loginEnabled).toBe(false);

    // O estado é exatamente o que a elegibilidade do convite exige — e o
    // que o resgate precisa encontrar para conseguir criar a Credential.
    const identidade = identidades.stored.get(resultado.identityPublicId)!;
    expect(identidade.getStatus().toString()).toBe("ACTIVE");
    expect(identidade.isLoginEnabled()).toBe(false);
  });

  it("a ativação é uma transição de domínio auditada, não um UPDATE de status", async () => {
    const { auditoria, service } = montar();
    await service.execute(PEDIDO_VALIDO);

    // `identity.activated` só existe se `Identity.activate()` rodou. Um
    // status forçado no banco não produziria este evento.
    expect(auditoria.tipos()).toEqual([
      "identity.created",
      "identity.activated",
      "membership.created",
      "application-access.granted"
    ]);
  });

  it("cria o vínculo e concede os acessos pedidos", async () => {
    const { vinculos, acessos, service } = montar();
    const resultado = await service.execute({
      ...PEDIDO_VALIDO,
      applicationCodes: ["PCTEC_PORTAL", "PCTEC_HELPDESK"]
    });

    expect(resultado.membership.profile).toBe("CUSTOMER");
    expect(resultado.membership.scope).toBe("ORGANIZATION_ONLY");
    expect(vinculos.stored).toHaveLength(1);
    expect(acessos.stored).toHaveLength(2);
    expect(resultado.applicationAccesses.map((a) => a.applicationCode)).toEqual([
      "PCTEC_PORTAL",
      "PCTEC_HELPDESK"
    ]);
  });

  it("concede SEMPRE o perfil USER — ADMIN não é alcançável por esta rota", async () => {
    const { acessos, service } = montar();
    // O contrato de entrada não tem campo de perfil: não existe valor a
    // mandar. É isso que torna "concessão administrativa é ação
    // separada e explícita" uma garantia do serviço, e não uma
    // convenção da tela que um POST direto contornaria.
    const resultado = await service.execute({
      ...PEDIDO_VALIDO,
      applicationCodes: ["PCTEC_PORTAL", "PCTEC_HELPDESK"]
    });

    expect(resultado.applicationAccesses.every((a) => a.accessProfile === "USER")).toBe(true);
    expect(acessos.stored.every((a) => a.getAccessProfile().toString() === "USER")).toBe(true);
  });

  it("BUSINESS_GROUP aceita ORGANIZATION_AND_DESCENDANTS", async () => {
    const { service } = montar();
    const resultado = await service.execute({
      ...PEDIDO_VALIDO,
      organizationPublicId: GRUPO,
      membershipScope: "ORGANIZATION_AND_DESCENDANTS"
    });
    expect(resultado.membership.scope).toBe("ORGANIZATION_AND_DESCENDANTS");
  });
});

describe("ProvisionOrganizationUserService — atomicidade", () => {
  it("falha ao conceder o segundo acesso não deixa Identity, vínculo nem primeiro acesso", async () => {
    const { identidades, vinculos, acessos, auditoria, service } = montar();
    acessos.falharNoSegundoInsert = true;

    await expect(
      service.execute({ ...PEDIDO_VALIDO, applicationCodes: ["PCTEC_PORTAL", "PCTEC_HELPDESK"] })
    ).rejects.toThrow(/segundo acesso/);

    // Nada de meio-caminho: é o cenário que o pedido proíbe
    // explicitamente, e o que aconteceria se cada serviço abrisse a
    // própria transação.
    expect(identidades.stored.size).toBe(0);
    expect(vinculos.stored).toHaveLength(0);
    expect(acessos.stored).toHaveLength(0);
    expect(auditoria.events).toHaveLength(0);
  });
});

describe("ProvisionOrganizationUserService — recusas", () => {
  it("e-mail duplicado é conflito (409)", async () => {
    const { identidades, service } = montar();
    await identidades.insert(
      Identity.create({
        type: "HUMAN",
        fullName: "Maria Souza",
        email: "maria.souza@example.invalid",
        actor: ActorPublicId.required(ADMIN),
        correlationId: randomUUID()
      })
    );

    await expect(service.execute(PEDIDO_VALIDO)).rejects.toBeInstanceOf(IdentityEmailAlreadyExistsError);
    expect(new IdentityEmailAlreadyExistsError().classification).toBe("CONFLICT");
  });

  it("COMPANY não aceita ORGANIZATION_AND_DESCENDANTS, e nada é escrito", async () => {
    const { identidades, auditoria, service } = montar();

    await expect(
      service.execute({ ...PEDIDO_VALIDO, membershipScope: "ORGANIZATION_AND_DESCENDANTS" })
    ).rejects.toBeInstanceOf(UserProvisioningScopeNotAllowedForCompanyError);
    expect(identidades.stored.size).toBe(0);
    expect(auditoria.events).toHaveLength(0);
  });

  it("organização INACTIVE é recusada", async () => {
    const { service } = montar();
    await expect(
      service.execute({ ...PEDIDO_VALIDO, organizationPublicId: COMPANY_INATIVA })
    ).rejects.toBeInstanceOf(MembershipOrganizationNotActiveError);
  });

  it("aplicação INACTIVE é recusada ANTES de criar a Identity", async () => {
    const { identidades, service } = montar();
    await expect(
      service.execute({ ...PEDIDO_VALIDO, applicationCodes: ["PCTEC_CLAIM"] })
    ).rejects.toBeInstanceOf(UserProvisioningApplicationNotActiveError);
    expect(identidades.stored.size).toBe(0);
  });

  it("aplicação inexistente é recusada ANTES de criar a Identity", async () => {
    const { identidades, service } = montar();
    await expect(
      service.execute({ ...PEDIDO_VALIDO, applicationCodes: ["PCTEC_NAO_EXISTE"] })
    ).rejects.toBeInstanceOf(ApplicationNotFoundError);
    expect(identidades.stored.size).toBe(0);
  });

  it("nenhuma aplicação selecionada é recusado", async () => {
    const { service } = montar();
    await expect(
      service.execute({ ...PEDIDO_VALIDO, applicationCodes: [] })
    ).rejects.toBeInstanceOf(UserProvisioningApplicationsRequiredError);
  });

  it("lista só com strings vazias conta como nenhuma aplicação", async () => {
    const { service } = montar();
    await expect(
      service.execute({ ...PEDIDO_VALIDO, applicationCodes: ["  ", ""] })
    ).rejects.toBeInstanceOf(UserProvisioningApplicationsRequiredError);
  });
});
