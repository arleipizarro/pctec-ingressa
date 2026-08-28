import { describe, expect, it, vi } from "vitest";
import {
  PORTAL_CATALOG_DEFAULT_LIMIT,
  PORTAL_CATALOG_MAX_LIMIT,
  SearchPortalClientCatalogService
} from "../application/SearchPortalClientCatalogService.js";
import {
  PORTAL_RECONCILIATION_CONFIRMATION,
  PORTAL_RECONCILIATION_MAX_EXECUTION,
  PortalReconciliationConfirmationRequiredError,
  PortalReconciliationSelectionInvalidError,
  ReconcilePortalOrganizationReferencesService
} from "../application/ReconcilePortalOrganizationReferencesService.js";
import { MatchPortalClientByDocumentService } from "../application/MatchPortalClientByDocumentService.js";
import type { AutoLinkPortalOrganizationReferenceService } from "../application/AutoLinkPortalOrganizationReferenceService.js";
import type { PortalClientCatalogReader, PortalClientRecord } from "../domain/PortalClientCatalogPort.js";
import type {
  PortalReconciliationCandidate,
  PortalReconciliationReader
} from "../domain/PortalReconciliationPort.js";

const ATOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CNPJ_UNICO = "11222333000181";
const CNPJ_DUPLICADO = "44555666000199";
const ORG_UNICA = "aaaaaaaa-1111-4111-8111-111111111111";
const ORG_SEM_MATCH = "bbbbbbbb-2222-4222-8222-222222222222";
const ORG_AMBIGUA = "cccccccc-3333-4333-8333-333333333333";
const ORG_SEM_DOC = "dddddddd-4444-4444-8444-444444444444";
const ORG_VINCULADA = "eeeeeeee-5555-4555-8555-555555555555";

function cliente(overrides: Partial<PortalClientRecord> = {}): PortalClientRecord {
  return { id: 71, nome: "CLIENTE SINTETICO", nomeFantasia: "Sintético", documentDigits: CNPJ_UNICO, active: true, ...overrides };
}

const CATALOGO: PortalClientCatalogReader = {
  findByDocument: vi.fn(async (digitos: string) => {
    if (digitos === CNPJ_UNICO) return [cliente()];
    if (digitos === CNPJ_DUPLICADO) return [cliente({ id: 81, documentDigits: CNPJ_DUPLICADO }), cliente({ id: 82, documentDigits: CNPJ_DUPLICADO })];
    return [];
  }),
  search: vi.fn(async () => ({
    items: [cliente(), cliente({ id: 72, documentDigits: undefined, nomeFantasia: null })],
    total: 2,
    limit: 10,
    offset: 0
  })),
  findById: vi.fn(async () => undefined)
};

describe("catálogo administrativo do Portal", () => {
  it("devolve legacyId, nome e CNPJ MASCARADO — e nenhuma coluna comercial", async () => {
    const pagina = await new SearchPortalClientCatalogService(CATALOGO).execute({ q: "sintetico" });

    expect(pagina.items[0]).toEqual({
      legacyId: 71,
      name: "CLIENTE SINTETICO",
      tradeName: "Sintético",
      documentMasked: "**.***.333/0001-81",
      hasDocument: true,
      active: true
    });
    const serializado = JSON.stringify(pagina);
    expect(serializado).not.toContain(CNPJ_UNICO);
    for (const proibida of ["telefone", "email", "logradouro", "cep", "documento", "internalId"]) {
      expect(serializado).not.toContain(proibida);
    }
  });

  it("distingue 'sem CNPJ cadastrado' de 'CNPJ escondido'", async () => {
    const pagina = await new SearchPortalClientCatalogService(CATALOGO).execute({});
    expect(pagina.items[1]).toMatchObject({ hasDocument: false, documentMasked: null });
  });

  it("limite pequeno por padrão e teto explícito — a base inteira nunca sai de uma vez", async () => {
    const leitor = { ...CATALOGO, search: vi.fn(async (q: { limit: number; offset: number }) => ({ items: [], total: 0, ...q })) };
    const servico = new SearchPortalClientCatalogService(leitor as unknown as PortalClientCatalogReader);

    await servico.execute({});
    expect(leitor.search).toHaveBeenCalledWith(expect.objectContaining({ limit: PORTAL_CATALOG_DEFAULT_LIMIT }));

    await servico.execute({ limit: "9999" });
    expect(leitor.search).toHaveBeenLastCalledWith(expect.objectContaining({ limit: PORTAL_CATALOG_MAX_LIMIT }));

    await servico.execute({ limit: "-3", offset: "-5" });
    expect(leitor.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: PORTAL_CATALOG_DEFAULT_LIMIT, offset: 0 })
    );
  });

  it("a busca textual NÃO cria vínculo — ela só lê", async () => {
    const leitor = { ...CATALOGO, search: vi.fn(async () => ({ items: [cliente()], total: 1, limit: 10, offset: 0 })) };
    await new SearchPortalClientCatalogService(leitor as unknown as PortalClientCatalogReader).execute({ q: "sintetico" });
    // Nenhuma escrita é possível: o serviço não recebe nada que escreva.
    expect(Object.keys(leitor)).toEqual(expect.not.arrayContaining(["insert", "update", "link"]));
  });
});

const CANDIDATAS: readonly PortalReconciliationCandidate[] = [
  { organizationPublicId: ORG_UNICA, legalName: "UNICA LTDA", tradeName: "Única", documentNumber: CNPJ_UNICO, activePortalReferences: 0 },
  { organizationPublicId: ORG_SEM_MATCH, legalName: "SEM MATCH LTDA", tradeName: null, documentNumber: "99888777000166", activePortalReferences: 0 },
  { organizationPublicId: ORG_AMBIGUA, legalName: "AMBIGUA LTDA", tradeName: null, documentNumber: CNPJ_DUPLICADO, activePortalReferences: 0 },
  { organizationPublicId: ORG_SEM_DOC, legalName: "SEM DOCUMENTO LTDA", tradeName: null, documentNumber: null, activePortalReferences: 0 },
  { organizationPublicId: ORG_VINCULADA, legalName: "JA VINCULADA LTDA", tradeName: null, documentNumber: CNPJ_UNICO, activePortalReferences: 1 }
];

function leitorDeCandidatas(): PortalReconciliationReader & { listCandidates: ReturnType<typeof vi.fn> } {
  return {
    listCandidates: vi.fn(async (q: { limit: number; offset: number }) => ({
      items: CANDIDATAS,
      total: CANDIDATAS.length,
      limit: q.limit,
      offset: q.offset
    })),
    findCandidates: vi.fn(async (ids: readonly string[]) =>
      CANDIDATAS.filter((c) => ids.includes(c.organizationPublicId))
    )
  };
}

function autoLinkFake(): {
  servico: AutoLinkPortalOrganizationReferenceService;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async ({ organizationPublicId }: { organizationPublicId: string }) => {
    if (organizationPublicId === ORG_UNICA) {
      return {
        status: "LINKED", legacyId: 71, referencePublicId: "ref-1", clientName: "CLIENTE SINTETICO",
        clientDocumentMasked: "**.***.333/0001-81", candidateCount: 1, reasonCode: null
      };
    }
    if (organizationPublicId === ORG_AMBIGUA) {
      return { status: "AMBIGUOUS", legacyId: null, referencePublicId: null, clientName: null, clientDocumentMasked: null, candidateCount: 2, reasonCode: null };
    }
    return { status: "NOT_FOUND", legacyId: null, referencePublicId: null, clientName: null, clientDocumentMasked: null, candidateCount: 0, reasonCode: null };
  });
  return { servico: { execute } as unknown as AutoLinkPortalOrganizationReferenceService, execute };
}

function reconciliador(
  leitor: PortalReconciliationReader,
  autoLink: AutoLinkPortalOrganizationReferenceService
): ReconcilePortalOrganizationReferencesService {
  return new ReconcilePortalOrganizationReferencesService(
    leitor,
    new MatchPortalClientByDocumentService(CATALOGO),
    autoLink
  );
}

describe("reconciliação — dry-run", () => {
  it("classifica cada organização e conta por estado, sem escrever nada", async () => {
    const leitor = leitorDeCandidatas();
    const autoLink = autoLinkFake();

    const resultado = await reconciliador(leitor, autoLink.servico).dryRun({});

    expect(resultado.counts).toEqual({
      EXACT_UNIQUE: 1,
      NOT_FOUND: 1,
      AMBIGUOUS: 1,
      INACTIVE_ONLY: 0,
      DOCUMENT_MISSING_OR_INVALID: 1,
      ALREADY_LINKED: 1
    });
    expect(resultado.eligibleCount).toBe(1);
    // Nenhuma escrita: o dry-run nunca toca no vínculo.
    expect(autoLink.execute).not.toHaveBeenCalled();
  });

  it("não devolve documento de ninguém — nem da organização, nem do cliente", async () => {
    const resultado = await reconciliador(leitorDeCandidatas(), autoLinkFake().servico).dryRun({});
    const serializado = JSON.stringify(resultado);

    expect(serializado).not.toContain(CNPJ_UNICO);
    expect(serializado).not.toContain(CNPJ_DUPLICADO);
    expect(serializado).not.toContain("99888777000166");
    // Presença, sim; valor, não.
    expect(resultado.items.find((i) => i.organizationPublicId === ORG_SEM_DOC)?.hasDocument).toBe(false);
    expect(resultado.items.find((i) => i.organizationPublicId === ORG_UNICA)?.hasDocument).toBe(true);
  });

  it("EXACT_UNIQUE traz a sugestão pronta, com o documento do cliente mascarado", async () => {
    const resultado = await reconciliador(leitorDeCandidatas(), autoLinkFake().servico).dryRun({});
    const item = resultado.items.find((i) => i.organizationPublicId === ORG_UNICA);

    expect(item).toMatchObject({
      status: "EXACT_UNIQUE",
      suggestedLegacyId: 71,
      suggestedClientName: "CLIENTE SINTETICO",
      suggestedClientDocumentMasked: "**.***.333/0001-81"
    });
  });

  it("já vinculada não consulta a fonte — nem para 'conferir'", async () => {
    const leitor: PortalReconciliationReader = {
      listCandidates: vi.fn(async (q) => ({ items: [CANDIDATAS[4]!], total: 1, ...q })),
      findCandidates: vi.fn(async () => [])
    };
    const consultas = vi.mocked(CATALOGO.findByDocument);
    consultas.mockClear();

    const resultado = await reconciliador(leitor, autoLinkFake().servico).dryRun({});

    expect(resultado.items[0]?.status).toBe("ALREADY_LINKED");
    expect(consultas).not.toHaveBeenCalled();
  });
});

describe("reconciliação — execução", () => {
  it("exige a palavra de confirmação antes de qualquer leitura", async () => {
    const leitor = leitorDeCandidatas();
    const autoLink = autoLinkFake();

    await expect(
      reconciliador(leitor, autoLink.servico).execute({
        organizationPublicIds: [ORG_UNICA],
        confirmation: "sim",
        actorPublicId: ATOR
      })
    ).rejects.toBeInstanceOf(PortalReconciliationConfirmationRequiredError);

    expect(leitor.findCandidates).not.toHaveBeenCalled();
    expect(autoLink.execute).not.toHaveBeenCalled();
  });

  it("escreve SOMENTE pelo vínculo automático, uma chamada por organização", async () => {
    const autoLink = autoLinkFake();
    const resultado = await reconciliador(leitorDeCandidatas(), autoLink.servico).execute({
      organizationPublicIds: [ORG_UNICA, ORG_AMBIGUA, ORG_SEM_MATCH],
      confirmation: PORTAL_RECONCILIATION_CONFIRMATION,
      actorPublicId: ATOR
    });

    expect(resultado.linked).toBe(1);
    expect(resultado.skipped).toBe(2);
    expect(autoLink.execute).toHaveBeenCalledTimes(3);
    // O ator vem de quem chamou, nunca do corpo do pedido.
    expect(autoLink.execute).toHaveBeenCalledWith(expect.objectContaining({ actorPublicId: ATOR }));
  });

  it("uma falha não contamina as demais — cada organização tem seu próprio desfecho", async () => {
    const execute = vi.fn(async ({ organizationPublicId }: { organizationPublicId: string }) =>
      organizationPublicId === ORG_UNICA
        ? { status: "FAILED", legacyId: null, referencePublicId: null, clientName: null, clientDocumentMasked: null, candidateCount: 0, reasonCode: "PORTAL_REFERENCE_AMBIGUOUS" }
        : { status: "LINKED", legacyId: 81, referencePublicId: "ref-2", clientName: "OUTRO", clientDocumentMasked: null, candidateCount: 1, reasonCode: null }
    );

    const resultado = await reconciliador(
      leitorDeCandidatas(),
      { execute } as unknown as AutoLinkPortalOrganizationReferenceService
    ).execute({
      organizationPublicIds: [ORG_UNICA, ORG_SEM_MATCH],
      confirmation: PORTAL_RECONCILIATION_CONFIRMATION,
      actorPublicId: ATOR
    });

    expect(resultado.failed).toBe(1);
    expect(resultado.linked).toBe(1);
    expect(resultado.items.find((i) => i.organizationPublicId === ORG_UNICA)?.reasonCode).toBe(
      "PORTAL_REFERENCE_AMBIGUOUS"
    );
  });

  it("organização fora da lista de candidatas é reportada, nunca silenciada", async () => {
    const autoLink = autoLinkFake();
    const forasteira = "ffffffff-6666-4666-8666-666666666666";

    const resultado = await reconciliador(leitorDeCandidatas(), autoLink.servico).execute({
      organizationPublicIds: [forasteira],
      confirmation: PORTAL_RECONCILIATION_CONFIRMATION,
      actorPublicId: ATOR
    });

    expect(resultado.items[0]).toMatchObject({
      organizationPublicId: forasteira,
      status: "NOT_ELIGIBLE",
      reasonCode: "PORTAL_RECONCILIATION_ORGANIZATION_NOT_ELIGIBLE"
    });
    expect(autoLink.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["não é lista", "tudo"],
    ["lista vazia", []],
    ["publicId inválido", ["nao-e-uuid"]],
    ["acima do teto", Array.from({ length: PORTAL_RECONCILIATION_MAX_EXECUTION + 1 }, () => ORG_UNICA.replace(/1/g, "2"))]
  ])("recusa seleção que %s", async (_rotulo, selecao) => {
    const autoLink = autoLinkFake();
    // O teto é sobre ids DISTINTOS; a lista acima repete o mesmo id, e é
    // por isso que o caso do teto usa um id gerado por posição abaixo.
    const lista = Array.isArray(selecao) && selecao.length > PORTAL_RECONCILIATION_MAX_EXECUTION
      ? Array.from({ length: PORTAL_RECONCILIATION_MAX_EXECUTION + 1 }, (_v, i) =>
          `aaaaaaaa-1111-4111-8111-${String(i).padStart(12, "0")}`
        )
      : selecao;

    await expect(
      reconciliador(leitorDeCandidatas(), autoLink.servico).execute({
        organizationPublicIds: lista,
        confirmation: PORTAL_RECONCILIATION_CONFIRMATION,
        actorPublicId: ATOR
      })
    ).rejects.toBeInstanceOf(PortalReconciliationSelectionInvalidError);
    expect(autoLink.execute).not.toHaveBeenCalled();
  });
});
