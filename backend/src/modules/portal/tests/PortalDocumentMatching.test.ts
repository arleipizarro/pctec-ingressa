import { describe, expect, it, vi } from "vitest";
import { CNPJ_DIGITS, maskCnpj, normalizePortalDocument } from "../domain/value-objects/PortalDocument.js";
import { MatchPortalClientByDocumentService } from "../application/MatchPortalClientByDocumentService.js";
import type { PortalClientCatalogReader, PortalClientRecord } from "../domain/PortalClientCatalogPort.js";

/**
 * CNPJs sintéticos. Nenhum documento real de cliente aparece nesta
 * suíte — nem no repositório, que é público.
 */
const CNPJ_A = "11222333000181";
const CNPJ_B = "44555666000199";

function cliente(overrides: Partial<PortalClientRecord> = {}): PortalClientRecord {
  return {
    id: 71,
    nome: "EMPRESA SINTETICA LTDA",
    nomeFantasia: "Sintética",
    documentDigits: CNPJ_A,
    active: true,
    ...overrides
  };
}

function catalogo(porDocumento: readonly PortalClientRecord[]): PortalClientCatalogReader {
  return {
    findByDocument: vi.fn(async () => porDocumento),
    search: vi.fn(async () => ({ items: [], total: 0, limit: 10, offset: 0 })),
    findById: vi.fn(async () => undefined)
  };
}

describe("normalização de CNPJ", () => {
  it("remove pontuação e mantém os 14 dígitos", () => {
    expect(normalizePortalDocument("11.222.333/0001-81")).toBe(CNPJ_A);
    expect(normalizePortalDocument(" 11222333000181 ")).toBe(CNPJ_A);
    expect(CNPJ_DIGITS).toBe(14);
  });

  it("recusa CPF — 11 dígitos nunca viram documento comparável", () => {
    expect(normalizePortalDocument("529.982.247-25")).toBeUndefined();
    expect(normalizePortalDocument("52998224725")).toBeUndefined();
  });

  it.each([
    ["vazio", ""],
    ["nulo", null],
    ["ausente", undefined],
    ["curto", "1122233300018"],
    ["longo", "112223330001812"],
    ["só pontuação", "../--"],
    ["texto", "EMPRESA SINTETICA"]
  ])("recusa %s", (_rotulo, entrada) => {
    expect(normalizePortalDocument(entrada as string | null | undefined)).toBeUndefined();
  });

  it("nunca lança — ausência e formato inválido são respostas, não erros", () => {
    expect(() => normalizePortalDocument("qualquer coisa")).not.toThrow();
  });
});

describe("máscara de CNPJ", () => {
  it("esconde a raiz e mostra ordem e dígitos verificadores", () => {
    expect(maskCnpj(CNPJ_A)).toBe("**.***.333/0001-81");
  });

  it("não devolve os 14 dígitos em sequência em lugar nenhum da máscara", () => {
    const mascarado = maskCnpj(CNPJ_A) ?? "";
    expect(mascarado).not.toContain(CNPJ_A);
    expect(mascarado.replace(/\D/g, "").length).toBeLessThan(14);
  });

  it("devolve null para valor não normalizado, em vez de uma máscara sem sentido", () => {
    expect(maskCnpj("112223330001")).toBeNull();
    expect(maskCnpj(undefined)).toBeNull();
    expect(maskCnpj(null)).toBeNull();
  });
});

describe("MatchPortalClientByDocumentService", () => {
  it("EXACT_UNIQUE quando exatamente um cliente tem o mesmo CNPJ", async () => {
    const leitor = catalogo([cliente()]);
    const resultado = await new MatchPortalClientByDocumentService(leitor).execute("11.222.333/0001-81");

    expect(resultado.status).toBe("EXACT_UNIQUE");
    expect(resultado.client?.id).toBe(71);
    expect(resultado.candidateCount).toBe(1);
    // A consulta recebe o documento JÁ normalizado — a fonte nunca vê
    // pontuação, e por isso a comparação é a mesma nos três chamadores.
    expect(leitor.findByDocument).toHaveBeenCalledWith(CNPJ_A);
  });

  it("NOT_FOUND quando nenhum cliente tem o CNPJ", async () => {
    const resultado = await new MatchPortalClientByDocumentService(catalogo([])).execute(CNPJ_A);
    expect(resultado).toEqual({ status: "NOT_FOUND", client: undefined, candidateCount: 0 });
  });

  it("AMBIGUOUS com mais de um, e NÃO elege nenhum", async () => {
    const leitor = catalogo([cliente({ id: 71 }), cliente({ id: 72 })]);
    const resultado = await new MatchPortalClientByDocumentService(leitor).execute(CNPJ_A);

    expect(resultado.status).toBe("AMBIGUOUS");
    expect(resultado.candidateCount).toBe(2);
    // Fail-closed: devolver "o primeiro com um aviso" convidaria quem
    // consome a ignorar o aviso.
    expect(resultado.client).toBeUndefined();
  });

  it("DOCUMENT_MISSING_OR_INVALID sem sequer consultar a fonte", async () => {
    const leitor = catalogo([cliente()]);
    const servico = new MatchPortalClientByDocumentService(leitor);

    for (const entrada of [undefined, null, "", "52998224725"]) {
      const resultado = await servico.execute(entrada);
      expect(resultado.status).toBe("DOCUMENT_MISSING_OR_INVALID");
    }
    expect(leitor.findByDocument).not.toHaveBeenCalled();
  });

  it("nunca correlaciona por nome — nome idêntico com CNPJ diferente não é correspondência", async () => {
    // A fonte devolve [] porque o CNPJ pedido é outro. Se houvesse
    // qualquer caminho por nome, este cliente homônimo apareceria.
    const leitor: PortalClientCatalogReader = {
      findByDocument: vi.fn(async (digitos: string) =>
        digitos === CNPJ_B ? [] : [cliente({ nome: "EMPRESA SINTETICA LTDA" })]
      ),
      search: vi.fn(async () => ({
        items: [cliente({ id: 999, nome: "EMPRESA SINTETICA LTDA", documentDigits: CNPJ_A })],
        total: 1,
        limit: 10,
        offset: 0
      })),
      findById: vi.fn(async () => undefined)
    };

    const resultado = await new MatchPortalClientByDocumentService(leitor).execute(CNPJ_B);

    expect(resultado.status).toBe("NOT_FOUND");
    // A busca textual existe para o ADMIN olhar; a correspondência
    // automática não a consulta.
    expect(leitor.search).not.toHaveBeenCalled();
  });
});
