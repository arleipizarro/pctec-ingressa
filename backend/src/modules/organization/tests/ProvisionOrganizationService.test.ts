import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { ProvisionOrganizationService } from "../application/ProvisionOrganizationService.js";
import { CreateOrganizationService } from "../application/CreateOrganizationService.js";
import { CreateOrganizationRelationshipService } from "../application/CreateOrganizationRelationshipService.js";
import { Organization } from "../domain/Organization.js";
import type { OrganizationRelationship } from "../domain/OrganizationRelationship.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../domain/OrganizationRelationshipRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import type { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import { DocumentNumberInvalidError, type DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import { OrganizationRelationshipParentMustBeBusinessGroupError } from "../domain/errors/OrganizationRelationshipErrors.js";
import {
  OrganizationParentNotActiveError,
  OrganizationParentOnlyForCompanyError
} from "../domain/errors/OrganizationProvisioningErrors.js";

const ACTOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

class InMemoryOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();

  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async existsByDocumentNumberAndType(
    _documentNumber: DocumentNumber,
    _type: OrganizationType
  ): Promise<boolean> {
    return false;
  }
  public async insert(organization: Organization): Promise<void> {
    this.stored.set(organization.getPublicId().toString(), organization);
  }
  public async update(_organization: Organization, _expectedVersion: number): Promise<void> {
    // sem estado a atualizar neste duplo
  }
}

class InMemoryRelationshipRepository implements OrganizationRelationshipRepository {
  public readonly stored: OrganizationRelationship[] = [];
  /** Liga para simular falha de escrita DEPOIS da organização já inserida. */
  public falharNoInsert = false;

  public async existsByChildOrganizationPublicId(child: PublicId): Promise<boolean> {
    return this.stored.some((r) => r.getChildOrganizationPublicId().equals(child));
  }
  public async findChildrenByParentPublicId(parent: PublicId): Promise<OrganizationRelationship[]> {
    return this.stored.filter((r) => r.getParentOrganizationPublicId().equals(parent));
  }
  public async insert(relationship: OrganizationRelationship): Promise<void> {
    if (this.falharNoInsert) {
      throw new Error("falha simulada de escrita do relacionamento");
    }
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
  public tipos(): string[] {
    return this.events.map((e) => e.eventType);
  }
}

/**
 * UnitOfWork que MODELA o rollback.
 *
 * Um `NoopUnitOfWork` (que só executa o callback) não conseguiria provar
 * nada sobre atomicidade: com ele, a organização inserida antes da falha
 * continuaria no mapa e o teste passaria mesmo se o serviço fosse não
 * atômico. Aqui os stores são fotografados antes e restaurados se o
 * trabalho lançar — que é exatamente o que `MariaDbUnitOfWork` faz com
 * BEGIN/ROLLBACK.
 */
class RollbackAwareUnitOfWork implements UnitOfWork {
  public constructor(
    private readonly organizacoes: InMemoryOrganizationRepository,
    private readonly relacionamentos: InMemoryRelationshipRepository,
    private readonly auditoria: InMemoryAuditEventRepository
  ) {}

  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    const orgsAntes = new Map(this.organizacoes.stored);
    const relsAntes = [...this.relacionamentos.stored];
    const auditAntes = [...this.auditoria.events];
    const conexao: Queryable = {
      execute: async () => {
        throw new Error("Este teste não deveria executar SQL real.");
      }
    };
    try {
      return await work(conexao);
    } catch (erro) {
      this.organizacoes.stored.clear();
      for (const [k, v] of orgsAntes) {
        this.organizacoes.stored.set(k, v);
      }
      this.relacionamentos.stored.length = 0;
      this.relacionamentos.stored.push(...relsAntes);
      this.auditoria.events.length = 0;
      this.auditoria.events.push(...auditAntes);
      throw erro;
    }
  }
}

function montar() {
  const organizacoes = new InMemoryOrganizationRepository();
  const relacionamentos = new InMemoryRelationshipRepository();
  const auditoria = new InMemoryAuditEventRepository();
  const service = new ProvisionOrganizationService(
    new RollbackAwareUnitOfWork(organizacoes, relacionamentos, auditoria),
    () => organizacoes,
    (uow) => new CreateOrganizationService(uow, () => organizacoes, () => auditoria),
    (uow) =>
      new CreateOrganizationRelationshipService(uow, () => organizacoes, () => relacionamentos, () => auditoria)
  );
  return { organizacoes, relacionamentos, auditoria, service };
}

function grupo(legalName: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE"): Organization {
  if (status === "ACTIVE") {
    return Organization.create({
      type: "BUSINESS_GROUP",
      legalName,
      actorPublicId: ACTOR,
      correlationId: randomUUID()
    });
  }
  return Organization.reconstitute({
    internalId: 99,
    publicId: randomUUID(),
    type: "BUSINESS_GROUP",
    legalName,
    status: "INACTIVE",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

describe("ProvisionOrganizationService — criação sem grupo", () => {
  it("cria a organização e não inventa relacionamento nem referência externa", async () => {
    const { organizacoes, relacionamentos, auditoria, service } = montar();

    const resultado = await service.execute({
      type: "COMPANY",
      legalName: "Empresa Nova Ltda",
      tradeName: "Empresa Nova",
      actorPublicId: ACTOR
    });

    expect(resultado.type).toBe("COMPANY");
    expect(resultado.status).toBe("ACTIVE");
    expect(resultado.relationshipPublicId).toBeNull();
    expect(organizacoes.stored.size).toBe(1);
    expect(relacionamentos.stored).toHaveLength(0);
    expect(auditoria.tipos()).toEqual(["organization.created"]);
  });

  it("nome fantasia é opcional", async () => {
    const { service } = montar();
    const resultado = await service.execute({
      type: "BUSINESS_GROUP",
      legalName: "Grupo Sem Fantasia",
      actorPublicId: ACTOR
    });
    expect(resultado.publicId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("ProvisionOrganizationService — criação com associação inicial", () => {
  it("grava organização e relacionamento, e audita os dois", async () => {
    const { organizacoes, relacionamentos, auditoria, service } = montar();
    const g = grupo("Grupo Primavera");
    await organizacoes.insert(g);

    const resultado = await service.execute({
      type: "COMPANY",
      legalName: "Empresa Filha Ltda",
      parentBusinessGroupPublicId: g.getPublicId().toString(),
      actorPublicId: ACTOR
    });

    expect(resultado.relationshipPublicId).not.toBeNull();
    expect(relacionamentos.stored).toHaveLength(1);
    expect(relacionamentos.stored[0]!.getChildOrganizationPublicId().toString()).toBe(resultado.publicId);
    expect(auditoria.tipos()).toEqual(["organization.created", "organization-relationship.created"]);
  });

  it("se o relacionamento falha, a organização NÃO fica criada", async () => {
    const { organizacoes, relacionamentos, auditoria, service } = montar();
    const g = grupo("Grupo Primavera");
    await organizacoes.insert(g);
    relacionamentos.falharNoInsert = true;

    await expect(
      service.execute({
        type: "COMPANY",
        legalName: "Empresa Que Não Deve Sobrar",
        parentBusinessGroupPublicId: g.getPublicId().toString(),
        actorPublicId: ACTOR
      })
    ).rejects.toThrow(/falha simulada/);

    // O grupo continua; a empresa nova não entrou. É a promessa "ou os
    // dois, ou nenhum" — e é o que quebraria se cada serviço abrisse a
    // própria transação.
    expect([...organizacoes.stored.values()].map((o) => o.getLegalName().toString())).toEqual([
      "Grupo Primavera"
    ]);
    expect(auditoria.events).toHaveLength(0);
  });
});

describe("ProvisionOrganizationService — recusas antes de escrever", () => {
  it("BUSINESS_GROUP com grupo pai é recusado", async () => {
    const { organizacoes, service } = montar();
    const g = grupo("Grupo Primavera");
    await organizacoes.insert(g);

    await expect(
      service.execute({
        type: "BUSINESS_GROUP",
        legalName: "Grupo Dentro de Grupo",
        parentBusinessGroupPublicId: g.getPublicId().toString(),
        actorPublicId: ACTOR
      })
    ).rejects.toBeInstanceOf(OrganizationParentOnlyForCompanyError);
    expect(organizacoes.stored.size).toBe(1);
  });

  it("grupo INACTIVE é recusado, e nada é criado", async () => {
    const { organizacoes, auditoria, service } = montar();
    const g = grupo("Grupo Desativado", "INACTIVE");
    await organizacoes.insert(g);

    await expect(
      service.execute({
        type: "COMPANY",
        legalName: "Empresa Órfã",
        parentBusinessGroupPublicId: g.getPublicId().toString(),
        actorPublicId: ACTOR
      })
    ).rejects.toBeInstanceOf(OrganizationParentNotActiveError);
    expect(organizacoes.stored.size).toBe(1);
    expect(auditoria.events).toHaveLength(0);
  });

  it("um pai que é COMPANY continua sendo recusado pela regra já existente", async () => {
    const { organizacoes, service } = montar();
    const empresa = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Que Não É Grupo",
      actorPublicId: ACTOR,
      correlationId: randomUUID()
    });
    await organizacoes.insert(empresa);

    await expect(
      service.execute({
        type: "COMPANY",
        legalName: "Empresa Filha",
        parentBusinessGroupPublicId: empresa.getPublicId().toString(),
        actorPublicId: ACTOR
      })
    ).rejects.toBeInstanceOf(OrganizationRelationshipParentMustBeBusinessGroupError);
  });

  /**
   * O CNPJ passou a ter campo na tela — e a tela não é a autoridade
   * sobre ele.
   */
  describe("documentNumber", () => {
    it("é transportado até a Organization criada", async () => {
      const { organizacoes, service } = montar();

      const criada = await service.execute({
        type: "COMPANY",
        legalName: "Empresa Com CNPJ",
        documentNumber: "11.222.333/0001-81",
        actorPublicId: ACTOR
      });

      const persistida = await organizacoes.findByPublicId(PublicId.fromString(criada.publicId));
      // Normalizado na persistência, como manda o Value Object.
      expect(persistida?.getDocumentNumber()?.normalized()).toBe("11222333000181");
    });

    it("documento inválido é RECUSADO pelo servidor, mesmo que a tela deixe passar", async () => {
      const { organizacoes, service } = montar();

      await expect(
        service.execute({
          type: "COMPANY",
          legalName: "Empresa Com CNPJ Torto",
          documentNumber: "11222333",
          actorPublicId: ACTOR
        })
      ).rejects.toBeInstanceOf(DocumentNumberInvalidError);

      // Recusa ANTES de escrever: nenhuma empresa meio-criada.
      expect(organizacoes.stored.size).toBe(0);
    });

    it("ausente continua criando normalmente — o documento nunca foi obrigatório", async () => {
      const { organizacoes, service } = montar();

      const criada = await service.execute({
        type: "COMPANY",
        legalName: "Empresa Sem CNPJ",
        actorPublicId: ACTOR
      });

      const persistida = await organizacoes.findByPublicId(PublicId.fromString(criada.publicId));
      expect(persistida?.getDocumentNumber()).toBeUndefined();
    });
  });
});
