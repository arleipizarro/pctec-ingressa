import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { GetPortalOrganizationCoverageService } from "../application/GetPortalOrganizationCoverageService.js";
import { Organization } from "../domain/Organization.js";
import { OrganizationRelationship } from "../domain/OrganizationRelationship.js";
import { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../domain/OrganizationRelationshipRepository.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { SystemCode } from "../domain/value-objects/SystemCode.js";
import type { EntityType } from "../domain/value-objects/EntityType.js";
import type { LegacyId } from "../domain/value-objects/LegacyId.js";
import type { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";

/**
 * Cobertura do Portal — "esta empresa está vinculada?", "este grupo está
 * inteiro?".
 *
 * É a MESMA resposta que a tela mostra e que o provisionamento usa para
 * recusar. Por isso o que estes testes fixam não é o formato: é o
 * significado de `covered` em cada topologia — inclusive nas duas que
 * costumam ser esquecidas, o grupo vazio e a filha desativada.
 */

const ATOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELACAO = "8f14e45f-ceea-467e-a1a3-000000000001";

class FakeOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();
  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async existsByDocumentNumberAndType(_d: DocumentNumber, _t: OrganizationType): Promise<boolean> {
    return false;
  }
  public async insert(_o: Organization): Promise<void> {}
  public async update(_o: Organization, _v: number): Promise<void> {}
}

class FakeRelationshipRepository implements OrganizationRelationshipRepository {
  public readonly stored: OrganizationRelationship[] = [];
  public async existsByChildOrganizationPublicId(_c: PublicId): Promise<boolean> {
    return false;
  }
  public async findChildrenByParentPublicId(parentPublicId: PublicId): Promise<OrganizationRelationship[]> {
    return this.stored.filter((r) => r.getParentOrganizationPublicId().equals(parentPublicId));
  }
  public async insert(relationship: OrganizationRelationship): Promise<void> {
    this.stored.push(relationship);
  }
}

class FakeReferenceRepository implements OrganizationExternalReferenceRepository {
  public readonly stored: OrganizationExternalReference[] = [];
  public async existsActiveBySystemCodeEntityTypeAndLegacyId(
    _s: SystemCode,
    _e: EntityType,
    _l: LegacyId
  ): Promise<boolean> {
    return false;
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

function montar() {
  const organizacoes = new FakeOrganizationRepository();
  const relacoes = new FakeRelationshipRepository();
  const referencias = new FakeReferenceRepository();
  const service = new GetPortalOrganizationCoverageService(organizacoes, relacoes, referencias);
  return { organizacoes, relacoes, referencias, service };
}

function organizacao(
  organizacoes: FakeOrganizationRepository,
  props: { type: "COMPANY" | "BUSINESS_GROUP"; status?: "ACTIVE" | "INACTIVE"; legalName?: string; tradeName?: string }
): string {
  const publicId = randomUUID();
  organizacoes.stored.set(
    publicId,
    Organization.reconstitute({
      internalId: organizacoes.stored.size + 1,
      publicId,
      type: props.type,
      legalName: props.legalName ?? "ORGANIZACAO SINTETICA LTDA",
      ...(props.tradeName === undefined ? {} : { tradeName: props.tradeName }),
      status: props.status ?? "ACTIVE",
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    })
  );
  return publicId;
}

function vincular(referencias: FakeReferenceRepository, organizationPublicId: string, legacyId: number): void {
  referencias.stored.push(
    OrganizationExternalReference.create({
      organizationPublicId,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId,
      actorPublicId: ATOR,
      correlationId: CORRELACAO
    })
  );
}

function relacionar(relacoes: FakeRelationshipRepository, parent: string, child: string): void {
  relacoes.stored.push(
    OrganizationRelationship.create({
      parentOrganizationPublicId: parent,
      childOrganizationPublicId: child,
      actorPublicId: ATOR,
      correlationId: CORRELACAO
    })
  );
}

describe("GetPortalOrganizationCoverageService — COMPANY", () => {
  it("empresa vinculada: covered, com o publicId técnico e o legacyId da referência", async () => {
    const { organizacoes, referencias, service } = montar();
    const empresa = organizacao(organizacoes, { type: "COMPANY" });
    vincular(referencias, empresa, 71);

    const cobertura = await service.execute(empresa);

    expect(cobertura?.covered).toBe(true);
    expect(cobertura?.reference?.legacyId).toBe(71);
    expect(cobertura?.reference?.status).toBe("ACTIVE");
    expect(cobertura?.reference?.publicId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(cobertura?.systemCode).toBe("PCTEC_PORTAL");
    expect(cobertura?.entityType).toBe("clientes");
    // Grupo é a outra metade do contrato: numa empresa, nunca preenchida.
    expect(cobertura?.group).toBeNull();
  });

  it("empresa sem referência: não coberta, sem referência nenhuma", async () => {
    const { organizacoes, service } = montar();
    const empresa = organizacao(organizacoes, { type: "COMPANY" });

    const cobertura = await service.execute(empresa);

    expect(cobertura?.covered).toBe(false);
    expect(cobertura?.reference).toBeNull();
  });

  it("referência de OUTRO sistema não cobre o Portal", async () => {
    const { organizacoes, referencias, service } = montar();
    const empresa = organizacao(organizacoes, { type: "COMPANY" });
    referencias.stored.push(
      OrganizationExternalReference.create({
        organizationPublicId: empresa,
        systemCode: "PCTEC_HELPDESK",
        entityType: "clients",
        legacyId: 71,
        actorPublicId: ATOR,
        correlationId: CORRELACAO
      })
    );

    expect((await service.execute(empresa))?.covered).toBe(false);
  });

  it("organização inexistente devolve undefined — quem chama decide o 404", async () => {
    const { service } = montar();
    expect(await service.execute(randomUUID())).toBeUndefined();
  });
});

describe("GetPortalOrganizationCoverageService — BUSINESS_GROUP", () => {
  it("todas as filhas vinculadas: coberto, sem nenhuma pendência", async () => {
    const { organizacoes, relacoes, referencias, service } = montar();
    const grupo = organizacao(organizacoes, { type: "BUSINESS_GROUP" });
    for (const legacyId of [71, 72]) {
      const filha = organizacao(organizacoes, { type: "COMPANY" });
      relacionar(relacoes, grupo, filha);
      vincular(referencias, filha, legacyId);
    }

    const cobertura = await service.execute(grupo);

    expect(cobertura?.covered).toBe(true);
    expect(cobertura?.group).toMatchObject({
      totalActiveCompanies: 2,
      linkedCompanies: 2,
      missingCompaniesCount: 0,
      missingCompanies: [],
      missingCompaniesTruncated: false
    });
    // Um grupo NUNCA tem referência própria — nem mesmo quando coberto.
    expect(cobertura?.reference).toBeNull();
  });

  it("cobertura parcial: lista a empresa que falta, só com publicId e nomes", async () => {
    const { organizacoes, relacoes, referencias, service } = montar();
    const grupo = organizacao(organizacoes, { type: "BUSINESS_GROUP" });
    const vinculada = organizacao(organizacoes, { type: "COMPANY" });
    const pendente = organizacao(organizacoes, {
      type: "COMPANY",
      legalName: "EMPRESA PENDENTE LTDA",
      tradeName: "Pendente"
    });
    relacionar(relacoes, grupo, vinculada);
    relacionar(relacoes, grupo, pendente);
    vincular(referencias, vinculada, 71);

    const cobertura = await service.execute(grupo);

    expect(cobertura?.covered).toBe(false);
    expect(cobertura?.group?.totalActiveCompanies).toBe(2);
    expect(cobertura?.group?.linkedCompanies).toBe(1);
    expect(cobertura?.group?.missingCompanies).toEqual([
      { publicId: pendente, legalName: "EMPRESA PENDENTE LTDA", tradeName: "Pendente" }
    ]);
    // Nada além de identificação organizacional: nenhum id legado,
    // nenhum documento, nenhum id interno.
    expect(JSON.stringify(cobertura?.group?.missingCompanies)).not.toMatch(/legacy|document|internal/i);
  });

  it("filha INACTIVE saiu do grupo: não conta como faltando nem como coberta", async () => {
    const { organizacoes, relacoes, referencias, service } = montar();
    const grupo = organizacao(organizacoes, { type: "BUSINESS_GROUP" });
    const ativa = organizacao(organizacoes, { type: "COMPANY" });
    const desativada = organizacao(organizacoes, { type: "COMPANY", status: "INACTIVE" });
    relacionar(relacoes, grupo, ativa);
    relacionar(relacoes, grupo, desativada);
    vincular(referencias, ativa, 71);

    const cobertura = await service.execute(grupo);

    expect(cobertura?.covered).toBe(true);
    expect(cobertura?.group?.totalActiveCompanies).toBe(1);
    expect(cobertura?.group?.missingCompaniesCount).toBe(0);
  });

  it("grupo sem nenhuma empresa ativa NÃO é coberto — não há o que consolidar", async () => {
    const { organizacoes, service } = montar();
    const grupo = organizacao(organizacoes, { type: "BUSINESS_GROUP" });

    const cobertura = await service.execute(grupo);

    expect(cobertura?.covered).toBe(false);
    expect(cobertura?.group?.totalActiveCompanies).toBe(0);
    expect(cobertura?.group?.missingCompaniesCount).toBe(0);
  });

  it("a mesma filha alcançada duas vezes é contada uma só", async () => {
    const { organizacoes, relacoes, service } = montar();
    const grupo = organizacao(organizacoes, { type: "BUSINESS_GROUP" });
    const filha = organizacao(organizacoes, { type: "COMPANY" });
    relacionar(relacoes, grupo, filha);
    relacionar(relacoes, grupo, filha);

    const cobertura = await service.execute(grupo);

    expect(cobertura?.group?.totalActiveCompanies).toBe(1);
    expect(cobertura?.group?.missingCompaniesCount).toBe(1);
  });

  it("acima do limite, a lista é recortada e o recorte é declarado — a contagem continua exata", async () => {
    const { organizacoes, relacoes, service } = montar();
    const grupo = organizacao(organizacoes, { type: "BUSINESS_GROUP" });
    for (let i = 0; i < 55; i += 1) {
      relacionar(relacoes, grupo, organizacao(organizacoes, { type: "COMPANY" }));
    }

    const cobertura = await service.execute(grupo);

    expect(cobertura?.group?.missingCompaniesCount).toBe(55);
    expect(cobertura?.group?.missingCompanies).toHaveLength(50);
    expect(cobertura?.group?.missingCompaniesTruncated).toBe(true);
  });
});
