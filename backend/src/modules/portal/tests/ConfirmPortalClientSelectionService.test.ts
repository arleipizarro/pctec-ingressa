import { describe, expect, it, vi } from "vitest";
import { ConfirmPortalClientSelectionService } from "../application/ConfirmPortalClientSelectionService.js";
import {
  PortalCatalogClientInactiveError,
  PortalCatalogClientNotFoundError,
  PortalCatalogLegacyIdInvalidError
} from "../domain/errors/PortalCatalogErrors.js";
import type { PortalClientCatalogReader, PortalClientRecord } from "../domain/PortalClientCatalogPort.js";
import type { LinkPortalOrganizationReferenceService } from "../../organization/application/LinkPortalOrganizationReferenceService.js";

const ORG = "971ec096-e7de-4cc1-be06-2b4709565757";
const ATOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CNPJ = "11222333000181";

function cliente(overrides: Partial<PortalClientRecord> = {}): PortalClientRecord {
  return { id: 71, nome: "CLIENTE SINTETICO", nomeFantasia: null, documentDigits: CNPJ, active: true, ...overrides };
}

function catalogo(porId: PortalClientRecord | undefined): PortalClientCatalogReader & {
  findById: ReturnType<typeof vi.fn>;
} {
  return {
    findByDocument: vi.fn(async () => []),
    search: vi.fn(async () => ({ items: [], total: 0, limit: 10, offset: 0 })),
    findById: vi.fn(async () => porId)
  };
}

function linkFake() {
  const execute = vi.fn(async (pedido: { organizationPublicId: string; legacyId: unknown }) => ({
    publicId: "5e2f1a77-2b4c-4c3f-9a1e-3d6f8b0c4a11",
    organizationPublicId: pedido.organizationPublicId,
    systemCode: "PCTEC_PORTAL",
    entityType: "clientes",
    legacyId: Number(pedido.legacyId),
    status: "ACTIVE",
    alreadyLinked: false
  }));
  return { execute, servico: { execute } as unknown as LinkPortalOrganizationReferenceService };
}

describe("confirmação de um cliente escolhido no catálogo", () => {
  it("RELÊ o cliente na fonte antes de escrever, e só então chama o serviço de vínculo", async () => {
    const leitor = catalogo(cliente());
    const link = linkFake();

    const resultado = await new ConfirmPortalClientSelectionService(leitor, link.servico).execute({
      organizationPublicId: ORG,
      legacyId: 71,
      actorPublicId: ATOR,
      correlationId: "corr-1"
    });

    expect(leitor.findById).toHaveBeenCalledWith(71);
    expect(link.execute).toHaveBeenCalledWith({
      organizationPublicId: ORG,
      legacyId: 71,
      actorPublicId: ATOR,
      correlationId: "corr-1"
    });
    expect(resultado.alreadyLinked).toBe(false);
  });

  it("cliente inexistente na fonte é recusado SEM escrever", async () => {
    const link = linkFake();
    const servico = new ConfirmPortalClientSelectionService(catalogo(undefined), link.servico);

    await expect(
      servico.execute({ organizationPublicId: ORG, legacyId: 71, actorPublicId: ATOR })
    ).rejects.toBeInstanceOf(PortalCatalogClientNotFoundError);
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("cliente INATIVO é recusado SEM escrever, com código próprio", async () => {
    const link = linkFake();
    const servico = new ConfirmPortalClientSelectionService(catalogo(cliente({ active: false })), link.servico);

    const falha = await servico
      .execute({ organizationPublicId: ORG, legacyId: 71, actorPublicId: ATOR })
      .catch((erro: unknown) => erro);

    expect(falha).toBeInstanceOf(PortalCatalogClientInactiveError);
    expect((falha as { code: string }).code).toBe("PORTAL_CATALOG_CLIENT_INACTIVE");
    // Código distinto do "não existe": a ação é reativar lá, não
    // escolher outro cliente.
    expect((falha as { code: string }).code).not.toBe("PORTAL_CATALOG_CLIENT_NOT_FOUND");
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("corrida lógica: ativo na busca, inativo na confirmação — recusa e nenhuma referência é criada", async () => {
    // Primeira leitura (a busca) devolve ativo; a segunda (a
    // confirmação) devolve inativo. É exatamente a janela que a
    // releitura existe para fechar.
    const leitor: PortalClientCatalogReader = {
      findByDocument: vi.fn(async () => []),
      search: vi.fn(async () => ({ items: [cliente({ active: true })], total: 1, limit: 10, offset: 0 })),
      findById: vi.fn(async () => cliente({ active: false }))
    };
    const link = linkFake();

    const pagina = await leitor.search({ q: "sintetico", limit: 10, offset: 0 });
    expect(pagina.items[0]?.active).toBe(true);

    await expect(
      new ConfirmPortalClientSelectionService(leitor, link.servico).execute({
        organizationPublicId: ORG,
        legacyId: 71,
        actorPublicId: ATOR
      })
    ).rejects.toBeInstanceOf(PortalCatalogClientInactiveError);
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("corrida lógica: cliente some entre a busca e a confirmação", async () => {
    const link = linkFake();
    await expect(
      new ConfirmPortalClientSelectionService(catalogo(undefined), link.servico).execute({
        organizationPublicId: ORG,
        legacyId: 71,
        actorPublicId: ATOR
      })
    ).rejects.toBeInstanceOf(PortalCatalogClientNotFoundError);
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("o que a resposta diz do cliente vem da RELEITURA, nunca do pedido", async () => {
    const leitor = catalogo(cliente({ nome: "NOME REAL DA FONTE" }));
    const resultado = await new ConfirmPortalClientSelectionService(leitor, linkFake().servico).execute({
      organizationPublicId: ORG,
      legacyId: 71,
      actorPublicId: ATOR
    });

    expect(resultado.clientName).toBe("NOME REAL DA FONTE");
    // Mascarado, sempre.
    expect(resultado.clientDocumentMasked).toBe("**.***.333/0001-81");
    expect(JSON.stringify(resultado)).not.toContain(CNPJ);
  });

  it("systemCode e entityType são do servidor — o contrato não tem onde recebê-los", async () => {
    const link = linkFake();
    await new ConfirmPortalClientSelectionService(catalogo(cliente()), link.servico).execute({
      organizationPublicId: ORG,
      legacyId: 71,
      actorPublicId: ATOR
    });

    const pedido = link.execute.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(pedido).sort()).toEqual(
      ["actorPublicId", "correlationId", "legacyId", "organizationPublicId"].sort()
    );
  });

  it.each([
    ["ausente", undefined],
    ["nulo", null],
    ["vazio", ""],
    ["zero", 0],
    ["negativo", -1],
    ["fracionário", 1.5],
    ["texto", "abc"],
    ["objeto", { id: 71 }]
  ])("legacyId %s é recusado ANTES de tocar na fonte", async (_rotulo, valor) => {
    const leitor = catalogo(cliente());
    const link = linkFake();

    await expect(
      new ConfirmPortalClientSelectionService(leitor, link.servico).execute({
        organizationPublicId: ORG,
        legacyId: valor,
        actorPublicId: ATOR
      })
    ).rejects.toBeInstanceOf(PortalCatalogLegacyIdInvalidError);
    expect(leitor.findById).not.toHaveBeenCalled();
    expect(link.execute).not.toHaveBeenCalled();
  });

  it("as recusas não citam SQL, host, usuário de banco, senha nem documento integral", async () => {
    const mensagens: string[] = [];
    for (const leitor of [catalogo(undefined), catalogo(cliente({ active: false }))]) {
      const falha = await new ConfirmPortalClientSelectionService(leitor, linkFake().servico)
        .execute({ organizationPublicId: ORG, legacyId: 71, actorPublicId: ATOR })
        .catch((erro: unknown) => erro);
      mensagens.push((falha as Error).message);
    }
    mensagens.push(new PortalCatalogLegacyIdInvalidError().message);

    for (const mensagem of mensagens) {
      const texto = mensagem.toLowerCase();
      for (const proibido of ["select", "insert", "update", "senha", "password", "mysql", "mariadb", "3306", CNPJ]) {
        expect(texto).not.toContain(proibido);
      }
    }
  });

  it("a recusa do serviço de vínculo sobe intacta — este serviço não a reinterpreta", async () => {
    const link = {
      execute: vi.fn(async () => {
        throw Object.assign(new Error("ambíguo"), { code: "PORTAL_REFERENCE_AMBIGUOUS" });
      })
    } as unknown as LinkPortalOrganizationReferenceService;

    const falha = await new ConfirmPortalClientSelectionService(catalogo(cliente()), link)
      .execute({ organizationPublicId: ORG, legacyId: 71, actorPublicId: ATOR })
      .catch((erro: unknown) => erro);

    expect((falha as { code: string }).code).toBe("PORTAL_REFERENCE_AMBIGUOUS");
  });

  it("vínculo idêntico já existente continua idempotente", async () => {
    const link = {
      execute: vi.fn(async () => ({
        publicId: "5e2f1a77-2b4c-4c3f-9a1e-3d6f8b0c4a11",
        organizationPublicId: ORG,
        systemCode: "PCTEC_PORTAL",
        entityType: "clientes",
        legacyId: 71,
        status: "ACTIVE",
        alreadyLinked: true
      }))
    } as unknown as LinkPortalOrganizationReferenceService;

    const resultado = await new ConfirmPortalClientSelectionService(catalogo(cliente()), link).execute({
      organizationPublicId: ORG,
      legacyId: "71",
      actorPublicId: ATOR
    });

    expect(resultado.alreadyLinked).toBe(true);
    expect(resultado.legacyId).toBe(71);
  });
});
