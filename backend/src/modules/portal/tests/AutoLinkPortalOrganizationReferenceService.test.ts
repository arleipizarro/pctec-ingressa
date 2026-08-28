import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Organization } from "../../organization/domain/Organization.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import type { PublicId } from "../../organization/domain/value-objects/PublicId.js";
import type { DocumentNumber } from "../../organization/domain/value-objects/DocumentNumber.js";
import type { OrganizationType } from "../../organization/domain/value-objects/OrganizationType.js";
import type { LinkPortalOrganizationReferenceService } from "../../organization/application/LinkPortalOrganizationReferenceService.js";
import { PortalReferenceAmbiguousError } from "../../organization/domain/errors/PortalOrganizationReferenceErrors.js";
import { OrganizationExternalReferenceAlreadyExistsError } from "../../organization/domain/errors/OrganizationExternalReferenceErrors.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import {
  AutoLinkPortalOrganizationReferenceService,
  PORTAL_AUTO_LINK_SOURCE_ERROR
} from "../application/AutoLinkPortalOrganizationReferenceService.js";
import { MatchPortalClientByDocumentService } from "../application/MatchPortalClientByDocumentService.js";
import type { PortalClientCatalogReader, PortalClientRecord } from "../domain/PortalClientCatalogPort.js";

const ATOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CNPJ = "11222333000181";

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

function organizacao(
  repositorio: FakeOrganizationRepository,
  props: {
    type?: "COMPANY" | "BUSINESS_GROUP";
    status?: "ACTIVE" | "INACTIVE";
    documentNumber?: string | undefined;
  } = {}
): string {
  const publicId = randomUUID();
  repositorio.stored.set(
    publicId,
    Organization.reconstitute({
      internalId: repositorio.stored.size + 1,
      publicId,
      type: props.type ?? "COMPANY",
      legalName: "ORGANIZACAO SINTETICA LTDA",
      status: props.status ?? "ACTIVE",
      ...(props.documentNumber !== undefined ? { documentNumber: props.documentNumber } : {}),
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    })
  );
  return publicId;
}

function cliente(overrides: Partial<PortalClientRecord> = {}): PortalClientRecord {
  return { id: 71, nome: "CLIENTE SINTETICO", nomeFantasia: null, documentDigits: CNPJ, active: true, ...overrides };
}

function catalogo(candidatos: readonly PortalClientRecord[]): PortalClientCatalogReader {
  return {
    findByDocument: vi.fn(async () => candidatos),
    search: vi.fn(async () => ({ items: [], total: 0, limit: 10, offset: 0 })),
    findById: vi.fn(async () => undefined)
  };
}

function linkServiceFake(
  comportamento: (pedido: { organizationPublicId: string; legacyId: unknown }) => unknown = () => ({})
): { servico: LinkPortalOrganizationReferenceService; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async (pedido: { organizationPublicId: string; legacyId: unknown }) => {
    const resposta = comportamento(pedido);
    return {
      publicId: "5e2f1a77-2b4c-4c3f-9a1e-3d6f8b0c4a11",
      organizationPublicId: pedido.organizationPublicId,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: Number(pedido.legacyId),
      status: "ACTIVE",
      alreadyLinked: false,
      ...(resposta as Record<string, unknown>)
    };
  });
  return { servico: { execute } as unknown as LinkPortalOrganizationReferenceService, execute };
}

const CONEXAO = {} as Queryable;

function montar(
  repositorio: FakeOrganizationRepository,
  leitor: PortalClientCatalogReader,
  link: LinkPortalOrganizationReferenceService
): AutoLinkPortalOrganizationReferenceService {
  return new AutoLinkPortalOrganizationReferenceService(
    () => repositorio,
    CONEXAO,
    new MatchPortalClientByDocumentService(leitor),
    link
  );
}

describe("vínculo automático por CNPJ", () => {
  it("EXACT_UNIQUE escreve pelo LinkPortalOrganizationReferenceService — e por mais nada", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = linkServiceFake();

    const resultado = await montar(repositorio, catalogo([cliente()]), link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR,
      correlationId: "corr-1"
    });

    expect(resultado.status).toBe("LINKED");
    expect(resultado.legacyId).toBe(71);
    // A escrita é DELEGADA: com o `FOR UPDATE`, a idempotência e a
    // auditoria do serviço oficial. Este serviço só decide quando.
    expect(link.execute).toHaveBeenCalledTimes(1);
    expect(link.execute).toHaveBeenCalledWith({
      organizationPublicId: publicId,
      legacyId: 71,
      actorPublicId: ATOR,
      correlationId: "corr-1"
    });
  });

  it("devolve o documento do cliente MASCARADO, nunca inteiro", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });

    const resultado = await montar(repositorio, catalogo([cliente()]), linkServiceFake().servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.clientDocumentMasked).toBe("**.***.333/0001-81");
    expect(JSON.stringify(resultado)).not.toContain(CNPJ);
  });

  it("vínculo idêntico já existente é idempotente e não vira novidade", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = linkServiceFake(() => ({ alreadyLinked: true }));

    const resultado = await montar(repositorio, catalogo([cliente()]), link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("ALREADY_LINKED");
    expect(resultado.legacyId).toBe(71);
  });

  it.each([
    ["NOT_FOUND", [] as readonly PortalClientRecord[]],
    ["AMBIGUOUS", [cliente({ id: 71 }), cliente({ id: 72 })]]
  ])("%s NÃO chama o serviço de vínculo", async (esperado, candidatos) => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = linkServiceFake();

    const resultado = await montar(repositorio, catalogo(candidatos), link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe(esperado);
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("organização sem CNPJ fica DOCUMENT_MISSING_OR_INVALID, sem consultar a fonte e sem escrever", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio);
    const leitor = catalogo([cliente()]);
    const link = linkServiceFake();

    const resultado = await montar(repositorio, leitor, link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("DOCUMENT_MISSING_OR_INVALID");
    expect(leitor.findByDocument).not.toHaveBeenCalled();
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("BUSINESS_GROUP nunca recebe vínculo — e a fonte nem é consultada", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { type: "BUSINESS_GROUP", documentNumber: CNPJ });
    const leitor = catalogo([cliente()]);
    const link = linkServiceFake();

    const resultado = await montar(repositorio, leitor, link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("NOT_A_COMPANY");
    expect(leitor.findByDocument).not.toHaveBeenCalled();
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("recusa de domínio do vínculo vira FAILED com o código estável, sem lançar", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = {
      execute: vi.fn(async () => {
        throw new PortalReferenceAmbiguousError(publicId, 2);
      })
    } as unknown as LinkPortalOrganizationReferenceService;

    const resultado = await montar(repositorio, catalogo([cliente()]), link).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("FAILED");
    expect(resultado.reasonCode).toBe("PORTAL_REFERENCE_AMBIGUOUS");
  });

  it("legacyId que já pertence a outra empresa vira FAILED — nunca sobrescreve", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const link = {
      execute: vi.fn(async () => {
        throw new OrganizationExternalReferenceAlreadyExistsError();
      })
    } as unknown as LinkPortalOrganizationReferenceService;

    const resultado = await montar(repositorio, catalogo([cliente()]), link).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("FAILED");
    expect(resultado.reasonCode).toBe("ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS");
  });

  it("indisponibilidade da fonte vira FAILED genérico — sem mensagem de driver na resposta", async () => {
    const repositorio = new FakeOrganizationRepository();
    const publicId = organizacao(repositorio, { documentNumber: CNPJ });
    const leitor: PortalClientCatalogReader = {
      findByDocument: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.9:3306 user=portal_ro");
      }),
      search: vi.fn(async () => ({ items: [], total: 0, limit: 10, offset: 0 })),
      findById: vi.fn(async () => undefined)
    };
    const link = linkServiceFake();

    const resultado = await montar(repositorio, leitor, link.servico).execute({
      organizationPublicId: publicId,
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("FAILED");
    expect(resultado.reasonCode).toBe(PORTAL_AUTO_LINK_SOURCE_ERROR);
    // A organização segue existindo e nada foi inventado.
    expect(link.execute).not.toHaveBeenCalled();
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain("ECONNREFUSED");
    expect(serializado).not.toContain("portal_ro");
    expect(serializado).not.toContain("3306");
  });

  it("organização inexistente vira FAILED, e não uma exceção que apagaria a resposta da criação", async () => {
    const repositorio = new FakeOrganizationRepository();
    const resultado = await montar(repositorio, catalogo([cliente()]), linkServiceFake().servico).execute({
      organizationPublicId: randomUUID(),
      actorPublicId: ATOR
    });

    expect(resultado.status).toBe("FAILED");
    expect(resultado.reasonCode).toBe("PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND");
  });
});
