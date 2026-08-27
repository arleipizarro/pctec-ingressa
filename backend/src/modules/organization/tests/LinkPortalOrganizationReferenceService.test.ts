import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { LinkPortalOrganizationReferenceService } from "../application/LinkPortalOrganizationReferenceService.js";
import type { CreateOrganizationExternalReferenceService } from "../application/CreateOrganizationExternalReferenceService.js";
import { Organization } from "../domain/Organization.js";
import { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { SystemCode } from "../domain/value-objects/SystemCode.js";
import type { EntityType } from "../domain/value-objects/EntityType.js";
import type { LegacyId } from "../domain/value-objects/LegacyId.js";
import type { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import { OrganizationExternalReferenceAlreadyExistsError } from "../domain/errors/OrganizationExternalReferenceErrors.js";
import {
  PortalReferenceAlreadyLinkedDifferentError,
  PortalReferenceCompanyRequiredError,
  PortalReferenceLegacyIdInvalidError,
  PortalReferenceOrganizationNotActiveError,
  PortalReferenceOrganizationNotFoundError
} from "../domain/errors/PortalOrganizationReferenceErrors.js";

/**
 * Vínculo administrativo de uma COMPANY ao Portal.
 *
 * A ESCRITA continua sendo do serviço oficial de criação de referência
 * externa — estes testes verificam QUANDO ela é legítima, e provam que
 * nas recusas ela nunca chega a ser chamada. "Recusou com a mensagem
 * certa" e "recusou sem escrever" são afirmações diferentes.
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

function montar(opcoes: { criacaoFalhaCom?: Error } = {}) {
  const organizacoes = new FakeOrganizationRepository();
  const referencias = new FakeReferenceRepository();
  const criar = vi.fn(async (pedido: { organizationPublicId: string; systemCode: string; entityType: string }) => {
    if (opcoes.criacaoFalhaCom !== undefined) {
      throw opcoes.criacaoFalhaCom;
    }
    return {
      publicId: randomUUID(),
      organizationPublicId: pedido.organizationPublicId,
      systemCode: pedido.systemCode,
      entityType: pedido.entityType,
      status: "ACTIVE"
    };
  });
  const service = new LinkPortalOrganizationReferenceService(
    organizacoes,
    referencias,
    { execute: criar } as unknown as CreateOrganizationExternalReferenceService
  );
  return { organizacoes, referencias, criar, service };
}

function organizacao(
  organizacoes: FakeOrganizationRepository,
  props: { type: "COMPANY" | "BUSINESS_GROUP"; status?: "ACTIVE" | "INACTIVE" } = { type: "COMPANY" }
): string {
  const publicId = randomUUID();
  organizacoes.stored.set(
    publicId,
    Organization.reconstitute({
      internalId: organizacoes.stored.size + 1,
      publicId,
      type: props.type,
      legalName: "ORGANIZACAO SINTETICA LTDA",
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

describe("LinkPortalOrganizationReferenceService — caminho feliz", () => {
  it("COMPANY ACTIVE sem vínculo: delega ao serviço oficial com systemCode e entityType FIXOS", async () => {
    const { organizacoes, criar, service } = montar();
    const empresa = organizacao(organizacoes);

    const resultado = await service.execute({
      organizationPublicId: empresa,
      legacyId: 71,
      actorPublicId: ATOR,
      correlationId: CORRELACAO
    });

    expect(resultado.alreadyLinked).toBe(false);
    expect(resultado.legacyId).toBe(71);
    expect(resultado.status).toBe("ACTIVE");
    expect(criar).toHaveBeenCalledTimes(1);
    expect(criar.mock.calls[0]?.[0]).toMatchObject({
      organizationPublicId: empresa,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 71,
      // O ator é o da sessão administrativa, repassado — nunca inventado.
      actorPublicId: ATOR
    });
  });

  it("aceita legacyId como string de dígitos, normalizando para número", async () => {
    const { organizacoes, criar, service } = montar();
    const empresa = organizacao(organizacoes);

    const resultado = await service.execute({
      organizationPublicId: empresa,
      legacyId: " 71 ",
      actorPublicId: ATOR
    });

    expect(resultado.legacyId).toBe(71);
    expect(criar.mock.calls[0]?.[0]).toMatchObject({ legacyId: 71 });
  });
});

describe("LinkPortalOrganizationReferenceService — idempotência e conflito", () => {
  it("mesmo vínculo repetido: devolve o existente, sem escrever e sem evento novo", async () => {
    const { organizacoes, referencias, criar, service } = montar();
    const empresa = organizacao(organizacoes);
    vincular(referencias, empresa, 71);

    const resultado = await service.execute({
      organizationPublicId: empresa,
      legacyId: 71,
      actorPublicId: ATOR
    });

    expect(resultado.alreadyLinked).toBe(true);
    expect(resultado.legacyId).toBe(71);
    expect(resultado.publicId).toBe(referencias.stored[0]?.getPublicId().toString());
    expect(criar).not.toHaveBeenCalled();
    expect(referencias.stored).toHaveLength(1);
  });

  it("vínculo ACTIVE para OUTRO legacyId: conflito, sem sobrescrever", async () => {
    const { organizacoes, referencias, criar, service } = montar();
    const empresa = organizacao(organizacoes);
    vincular(referencias, empresa, 71);

    await expect(
      service.execute({ organizationPublicId: empresa, legacyId: 99, actorPublicId: ATOR })
    ).rejects.toBeInstanceOf(PortalReferenceAlreadyLinkedDifferentError);

    expect(criar).not.toHaveBeenCalled();
    expect(referencias.stored).toHaveLength(1);
    expect(referencias.stored[0]?.getLegacyId().toNumber()).toBe(71);
  });

  it("legacyId já usado por OUTRA organização: o conflito do serviço oficial sobe intacto", async () => {
    // Invariante global (systemCode, entityType, legacyId) — a autoridade
    // é a UNIQUE KEY, e o código de erro dela não é reescrito aqui.
    const { organizacoes, service } = montar({
      criacaoFalhaCom: new OrganizationExternalReferenceAlreadyExistsError()
    });
    const empresa = organizacao(organizacoes);

    await expect(
      service.execute({ organizationPublicId: empresa, legacyId: 71, actorPublicId: ATOR })
    ).rejects.toMatchObject({
      code: "ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS",
      classification: "CONFLICT"
    });
  });
});

describe("LinkPortalOrganizationReferenceService — recusas, sempre antes de escrever", () => {
  it("BUSINESS_GROUP: recusado com erro de domínio próprio", async () => {
    const { organizacoes, criar, service } = montar();
    const grupo = organizacao(organizacoes, { type: "BUSINESS_GROUP" });

    const falha = await service
      .execute({ organizationPublicId: grupo, legacyId: 71, actorPublicId: ATOR })
      .catch((erro: unknown) => erro);

    expect(falha).toBeInstanceOf(PortalReferenceCompanyRequiredError);
    // A mensagem precisa dizer o que fazer: vincular cada empresa.
    expect((falha as Error).message).toMatch(/empresas filhas/i);
    expect(criar).not.toHaveBeenCalled();
  });

  it("COMPANY INACTIVE: recusada", async () => {
    const { organizacoes, criar, service } = montar();
    const empresa = organizacao(organizacoes, { type: "COMPANY", status: "INACTIVE" });

    await expect(
      service.execute({ organizationPublicId: empresa, legacyId: 71, actorPublicId: ATOR })
    ).rejects.toBeInstanceOf(PortalReferenceOrganizationNotActiveError);
    expect(criar).not.toHaveBeenCalled();
  });

  it("organização inexistente: recusada com o código que a rota mapeia para 404", async () => {
    const { criar, service } = montar();

    const falha = await service
      .execute({ organizationPublicId: randomUUID(), legacyId: 71, actorPublicId: ATOR })
      .catch((erro: unknown) => erro);

    expect(falha).toBeInstanceOf(PortalReferenceOrganizationNotFoundError);
    expect((falha as { code: string }).code).toBe("PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND");
    expect(criar).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", 0],
    ["negativo", -1],
    ["fracionário", 1.5],
    ["texto", "abc"],
    ["string vazia", ""],
    ["ausente", undefined],
    ["nulo", null],
    ["objeto", { legacyId: 71 }],
    ["notação científica", "1e3"]
  ])("legacyId %s é recusado antes de qualquer leitura de organização", async (_rotulo, valor) => {
    const { organizacoes, criar, service } = montar();
    const empresa = organizacao(organizacoes);

    await expect(
      service.execute({ organizationPublicId: empresa, legacyId: valor, actorPublicId: ATOR })
    ).rejects.toBeInstanceOf(PortalReferenceLegacyIdInvalidError);
    expect(criar).not.toHaveBeenCalled();
  });
});
