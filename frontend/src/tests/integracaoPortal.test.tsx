import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import * as fixtures from "./fixtures.js";

/**
 * Gestão administrativa da referência do Portal.
 *
 * As invariantes que estes testes protegem:
 *
 * - empresa não vinculada oferece o caminho do vínculo; vinculada mostra
 *   o estado, e nada de trocar/revogar (não existe no servidor);
 * - grupo mostra cobertura e as empresas pendentes, e NUNCA um campo de
 *   id — grupo não tem `clientes.id` próprio;
 * - `PCTEC_PORTAL` sem cobertura bloqueia a criação do usuário, e as
 *   demais aplicações continuam livres;
 * - depois de vincular, a tela recarrega e o formulário libera;
 * - 409/422 chegam como frase que diz o que aconteceu, não como o texto
 *   genérico do status;
 * - o convite continua opcional e intacto.
 */

const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "Administrador Sintetico" },
  applications: [{ code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" }]
};

function organizacao(overrides: Record<string, unknown> = {}) {
  return {
    ...fixtures.ORGANIZACAO_DETALHE,
    type: "COMPANY",
    status: "ACTIVE",
    legal_name: "EMPRESA SINTETICA LTDA",
    version: 2,
    parents: [],
    ...overrides
  } as never;
}

function renderizar() {
  return render(
    <MemoryRouter initialEntries={[`/admin/organizacoes/${fixtures.ORG_PUBLIC_ID}`]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(PAINEL_ADMIN as never);
  vi.spyOn(api, "organizations").mockResolvedValue({ items: [], total: 0, limit: 200, offset: 0 } as never);
  vi.spyOn(api, "applications").mockResolvedValue(fixtures.APLICACOES_COM_PORTAL as never);
});

afterEach(() => vi.restoreAllMocks());

async function abrirNovoUsuario() {
  await userEvent.click(await screen.findByRole("button", { name: "Novo usuário" }));
  return screen.findByRole("dialog", { name: "Novo usuário" });
}

/** Preenche o mínimo e marca as aplicações pedidas. */
async function preencher(dialogo: HTMLElement, aplicacoes: readonly string[]) {
  await userEvent.type(within(dialogo).getByLabelText("Nome completo"), "Pessoa Sintetica");
  await userEvent.type(within(dialogo).getByLabelText("E-mail"), "pessoa.sintetica@example.invalid");
  for (const code of aplicacoes) {
    await userEvent.click(within(dialogo).getByRole("checkbox", { name: new RegExp(code) }));
  }
}

// ---------------------------------------------------------------------------
// Seção "Integração com o Portal"
// ---------------------------------------------------------------------------

describe("seção Integração com o Portal — COMPANY", () => {
  it("empresa sem vínculo mostra o caminho para criá-lo", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO })
    );
    renderizar();

    expect(await screen.findByTestId("portal-estado-empresa")).toHaveTextContent(/ainda não está vinculada/i);
    expect(screen.getByRole("button", { name: "Vincular ao Portal" })).toBeEnabled();
  });

  it("empresa vinculada mostra o estado e o id do cliente — sem oferecer trocar ou revogar", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_VINCULADA })
    );
    renderizar();

    const estado = await screen.findByTestId("portal-estado-empresa");
    expect(estado).toHaveTextContent(/vinculada/i);
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vincular ao Portal" })).not.toBeInTheDocument();
    for (const proibido of [/trocar vínculo/i, /revogar/i, /excluir vínculo/i]) {
      expect(screen.queryByRole("button", { name: proibido })).not.toBeInTheDocument();
    }
  });

  it("organização INACTIVE não oferece o vínculo", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({
        status: "INACTIVE",
        portal: { ...fixtures.PORTAL_EMPRESA_SEM_VINCULO, organizationStatus: "INACTIVE" }
      })
    );
    renderizar();

    await screen.findByTestId("portal-estado-empresa");
    expect(screen.getByRole("button", { name: "Vincular ao Portal" })).toBeDisabled();
  });

  it("resposta sem o campo `portal` não é lida como “não vinculada”", async () => {
    // Compatibilidade com resposta anterior a esta fatia: cobertura
    // desconhecida, e a tela não inventa estado a partir do silêncio.
    vi.spyOn(api, "organization").mockResolvedValue(organizacao());
    renderizar();

    expect(await screen.findByText(/estado da integração indisponível/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-estado-empresa")).not.toBeInTheDocument();
  });
});

describe("seção Integração com o Portal — BUSINESS_GROUP", () => {
  it("mostra a cobertura e as empresas pendentes, com link para cada uma", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ type: "BUSINESS_GROUP", portal: fixtures.PORTAL_GRUPO_PARCIAL })
    );
    renderizar();

    expect(await screen.findByTestId("portal-cobertura-grupo")).toHaveTextContent("1");
    expect(screen.getByTestId("portal-cobertura-grupo")).toHaveTextContent("2");
    const link = screen.getByRole("link", { name: "EMPRESA PENDENTE LTDA" });
    expect(link).toHaveAttribute("href", `/admin/organizacoes/${fixtures.EMPRESA_PENDENTE_PUBLIC_ID}`);
    expect(screen.getByText(/não recebe vínculo próprio/i)).toBeInTheDocument();
  });

  it("grupo NUNCA mostra o campo de id do cliente, nem o botão de vincular", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ type: "BUSINESS_GROUP", portal: fixtures.PORTAL_GRUPO_PARCIAL })
    );
    renderizar();

    await screen.findByTestId("portal-cobertura-grupo");
    expect(screen.queryByRole("button", { name: "Vincular ao Portal" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ID do cliente no Portal")).not.toBeInTheDocument();
  });

  it("cobertura completa é anunciada como completa", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ type: "BUSINESS_GROUP", portal: fixtures.PORTAL_GRUPO_COMPLETO })
    );
    renderizar();

    expect(await screen.findByText("Cobertura completa.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Criação do vínculo
// ---------------------------------------------------------------------------

describe("criação do vínculo — busca e seleção", () => {
  const CLIENTE_71 = {
    legacyId: 71,
    name: "EMPRESA SINTETICA LTDA",
    tradeName: "Sintética",
    documentMasked: "**.***.333/0001-81",
    hasDocument: true,
    active: true
  };
  const CLIENTE_72 = {
    legacyId: 72,
    name: "EMPRESA SINTETICA FILIAL LTDA",
    tradeName: null,
    documentMasked: "**.***.333/0002-62",
    hasDocument: true,
    active: true
  };

  const SEM_CORRESPONDENCIA = {
    organizationPublicId: fixtures.ORG_PUBLIC_ID,
    status: "NOT_FOUND" as const,
    hasDocument: true,
    candidateCount: 0,
    suggestion: null
  };

  function correspondencia(overrides: Record<string, unknown> = {}) {
    return { ...SEM_CORRESPONDENCIA, ...overrides } as never;
  }

  function catalogo(items: readonly unknown[], total = items.length) {
    return { items, total, limit: 10, offset: 0 } as never;
  }

  beforeEach(() => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO })
    );
    vi.spyOn(api, "portalMatch").mockResolvedValue(correspondencia());
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([]));
  });

  async function abrirVinculo() {
    await userEvent.click(await screen.findByRole("button", { name: "Vincular ao Portal" }));
    return screen.findByRole("dialog", { name: "Vincular ao Portal" });
  }

  it("não existe mais campo cru de id do cliente — a escolha é por busca", async () => {
    renderizar();
    const dialogo = await abrirVinculo();

    expect(within(dialogo).queryByLabelText("ID do cliente no Portal")).not.toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Buscar cliente no Portal")).toBeInTheDocument();
  });

  it("sugere o cliente quando o CNPJ bate com exatamente um, e ainda exige confirmação", async () => {
    vi.spyOn(api, "portalMatch").mockResolvedValue(
      correspondencia({
        status: "EXACT_UNIQUE",
        candidateCount: 1,
        suggestion: { ...CLIENTE_71, documentMasked: "**.***.333/0001-81" }
      })
    );
    const vincular = vi.spyOn(api, "confirmPortalSelection").mockResolvedValue({
      publicId: "99999999-9999-4999-8999-999999999999",
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 71,
      status: "ACTIVE",
      alreadyLinked: false,
      clientName: "CLIENTE SINTETICO",
      clientDocumentMasked: "**.***.333/0001-81"
    });
    renderizar();
    const dialogo = await abrirVinculo();

    const sugestao = await within(dialogo).findByTestId("portal-sugestao");
    expect(sugestao).toHaveTextContent("EMPRESA SINTETICA LTDA");
    expect(sugestao).toHaveTextContent("**.***.333/0001-81");
    // Nada foi escrito só por haver correspondência.
    expect(vincular).not.toHaveBeenCalled();

    await userEvent.click(within(sugestao).getByRole("button", { name: "Confirmar este cliente" }));
    await waitFor(() => expect(vincular).toHaveBeenCalledWith(fixtures.ORG_PUBLIC_ID, 71));
  });

  it("sem correspondência automática, explica e manda buscar", async () => {
    renderizar();
    const dialogo = await abrirVinculo();

    expect(await within(dialogo).findByTestId("portal-sem-sugestao")).toHaveTextContent(
      /Nenhum cliente do Portal tem o CNPJ desta empresa/i
    );
  });

  it("correspondência ambígua não sugere ninguém e diz por quê", async () => {
    vi.spyOn(api, "portalMatch").mockResolvedValue(
      correspondencia({ status: "AMBIGUOUS", candidateCount: 2 })
    );
    renderizar();
    const dialogo = await abrirVinculo();

    expect(await within(dialogo).findByTestId("portal-sem-sugestao")).toHaveTextContent(
      /Mais de um cliente ATIVO do Portal tem o CNPJ desta empresa/i
    );
    expect(within(dialogo).queryByTestId("portal-sugestao")).not.toBeInTheDocument();
  });

  it("organização sem CNPJ cai direto na seleção manual", async () => {
    vi.spyOn(api, "portalMatch").mockResolvedValue(
      correspondencia({ status: "DOCUMENT_MISSING_OR_INVALID", hasDocument: false })
    );
    renderizar();
    const dialogo = await abrirVinculo();

    expect(await within(dialogo).findByTestId("portal-sem-sugestao")).toHaveTextContent(
      /não tem CNPJ cadastrado no Ingressa/i
    );
  });

  it("busca por nome lista candidatos com CNPJ mascarado", async () => {
    const buscar = vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71, CLIENTE_72]));
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));

    expect(await within(dialogo).findByText("EMPRESA SINTETICA FILIAL LTDA")).toBeInTheDocument();
    expect(within(dialogo).getByText("**.***.333/0001-81")).toBeInTheDocument();
    expect(buscar).toHaveBeenCalledWith(expect.any(URLSearchParams));
    expect(buscar.mock.calls[0]?.[0].get("q")).toBe("sintetica");
  });

  it("busca por CNPJ manda o documento como termo", async () => {
    const buscar = vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71]));
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "11.222.333/0001-81");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));

    await waitFor(() => expect(buscar.mock.calls[0]?.[0].get("q")).toBe("11.222.333/0001-81"));
  });

  it("busca sem resultado diz que não encontrou — e não vincula nada", async () => {
    const vincular = vi.spyOn(api, "confirmPortalSelection");
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "inexistente");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));

    expect(await within(dialogo).findByTestId("portal-busca-vazia")).toBeInTheDocument();
    expect(vincular).not.toHaveBeenCalled();
  });

  it("um resultado só NÃO vincula sozinho — a seleção é explícita", async () => {
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71]));
    const vincular = vi.spyOn(api, "confirmPortalSelection");
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));
    await within(dialogo).findByLabelText("Selecionar EMPRESA SINTETICA LTDA");

    // Resultado único de busca TEXTUAL continua sendo coincidência de
    // nome — e nome não é evidência nesta integração.
    expect(within(dialogo).getByRole("button", { name: "Confirmar vínculo" })).toBeDisabled();
    expect(vincular).not.toHaveBeenCalled();
  });

  it("seleção explícita habilita a confirmação e envia o legacyId escolhido", async () => {
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71, CLIENTE_72]));
    const vincular = vi.spyOn(api, "confirmPortalSelection").mockResolvedValue({
      publicId: "99999999-9999-4999-8999-999999999999",
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 72,
      status: "ACTIVE",
      alreadyLinked: false,
      clientName: "EMPRESA SINTETICA FILIAL LTDA",
      clientDocumentMasked: "**.***.333/0002-62"
    });
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));

    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar vínculo" });
    expect(confirmar).toBeDisabled();

    await userEvent.click(
      await within(dialogo).findByLabelText("Selecionar EMPRESA SINTETICA FILIAL LTDA")
    );
    expect(confirmar).toBeEnabled();

    await userEvent.click(confirmar);
    await waitFor(() => expect(vincular).toHaveBeenCalledWith(fixtures.ORG_PUBLIC_ID, 72));
  });

  it("cliente inativo APARECE na busca, identificado, mas não pode ser selecionado", async () => {
    const inativo = { ...CLIENTE_72, name: "EMPRESA DESATIVADA LTDA", active: false };
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71, inativo]));
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "empresa");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));

    // Some da lista, alguém procuraria em vão um cadastro que existe.
    expect(await within(dialogo).findByText("EMPRESA DESATIVADA LTDA")).toBeInTheDocument();
    expect(within(dialogo).getByTestId(`portal-cliente-inativo-${inativo.legacyId}`)).toHaveTextContent(
      /não pode ser vinculado/i
    );
    // Mas não tem seletor: oferecer o clique e recusar depois é pior.
    expect(within(dialogo).queryByLabelText("Selecionar EMPRESA DESATIVADA LTDA")).not.toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Selecionar EMPRESA SINTETICA LTDA")).toBeInTheDocument();
  });

  it("com apenas um resultado, e ele inativo, a confirmação segue desabilitada", async () => {
    const inativo = { ...CLIENTE_71, active: false };
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([inativo]));
    const confirmar = vi.spyOn(api, "confirmPortalSelection");
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));
    await within(dialogo).findByTestId(`portal-cliente-inativo-${inativo.legacyId}`);

    expect(within(dialogo).getByRole("button", { name: "Confirmar vínculo" })).toBeDisabled();
    expect(within(dialogo).queryByLabelText("Selecionar EMPRESA SINTETICA LTDA")).not.toBeInTheDocument();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("CNPJ existente só em cliente inativo tem mensagem própria, distinta de “não encontrado”", async () => {
    vi.spyOn(api, "portalMatch").mockResolvedValue(
      correspondencia({ status: "INACTIVE_ONLY", candidateCount: 1 })
    );
    renderizar();
    const dialogo = await abrirVinculo();

    expect(await within(dialogo).findByTestId("portal-sem-sugestao")).toHaveTextContent(
      /apenas em cliente INATIVO/i
    );
    // Dizer "não encontrado" mandaria cadastrar de novo a mesma empresa.
    expect(within(dialogo).getByTestId("portal-sem-sugestao")).not.toHaveTextContent(
      /Nenhum cliente do Portal tem o CNPJ/i
    );
    expect(within(dialogo).queryByTestId("portal-sugestao")).not.toBeInTheDocument();
  });

  it("sugestão de cliente inativo nunca vira botão de confirmar", async () => {
    // Resposta que não deveria existir — o servidor não produz
    // `EXACT_UNIQUE` para inativo. A tela recusa mesmo assim: o custo de
    // errar é um vínculo irreversível para um cadastro morto.
    vi.spyOn(api, "portalMatch").mockResolvedValue(
      correspondencia({
        status: "EXACT_UNIQUE",
        candidateCount: 1,
        suggestion: { ...CLIENTE_71, active: false }
      })
    );
    const confirmar = vi.spyOn(api, "confirmPortalSelection");
    renderizar();
    const dialogo = await abrirVinculo();

    await within(dialogo).findByLabelText("Buscar cliente no Portal");
    expect(within(dialogo).queryByTestId("portal-sugestao")).not.toBeInTheDocument();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("a confirmação usa a rota que relê a fonte, não a rota operacional do PR anterior", async () => {
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71]));
    const operacional = vi.spyOn(api, "linkPortalReference");
    const confirmar = vi.spyOn(api, "confirmPortalSelection").mockResolvedValue({
      publicId: "99999999-9999-4999-8999-999999999999",
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 71,
      status: "ACTIVE",
      alreadyLinked: false,
      clientName: "CLIENTE SINTETICO",
      clientDocumentMasked: "**.***.333/0001-81"
    });
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));
    await userEvent.click(await within(dialogo).findByLabelText("Selecionar EMPRESA SINTETICA LTDA"));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar vínculo" }));

    await waitFor(() => expect(confirmar).toHaveBeenCalledWith(fixtures.ORG_PUBLIC_ID, 71));
    // O `legacyId` daqui veio de uma lista que o servidor montou;
    // devolvê-lo sem releitura trataria a resposta anterior como
    // autoridade.
    expect(operacional).not.toHaveBeenCalled();
  });

  it.each([
    ["PORTAL_CATALOG_CLIENT_NOT_FOUND", /não existe mais no Portal/i],
    ["PORTAL_CATALOG_CLIENT_INACTIVE", /foi inativado no Portal/i]
  ])("recusa %s da releitura vira frase própria", async (code, esperado) => {
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71]));
    vi.spyOn(api, "confirmPortalSelection").mockRejectedValue(
      new ApiError(code === "PORTAL_CATALOG_CLIENT_NOT_FOUND" ? 404 : 409, code, "mensagem genérica do status")
    );
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));
    await userEvent.click(await within(dialogo).findByLabelText("Selecionar EMPRESA SINTETICA LTDA"));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar vínculo" }));

    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByText("mensagem genérica do status")).not.toBeInTheDocument();
  });

  it("o aviso de alcance irreversível continua no modal", async () => {
    renderizar();
    const dialogo = await abrirVinculo();
    expect(within(dialogo).getByText(/todos os usuários do Portal desta empresa/i)).toBeInTheDocument();
  });

  it("fonte indisponível é dita como tal — nunca como “nada encontrado”", async () => {
    vi.spyOn(api, "portalMatch").mockRejectedValue(
      new ApiError(503, "PORTAL_CATALOG_SOURCE_NOT_CONFIGURED", "indisponível")
    );
    renderizar();
    const dialogo = await abrirVinculo();

    expect(await within(dialogo).findByTestId("portal-catalogo-indisponivel")).toHaveTextContent(
      /configuração da fonte não está presente/i
    );
    expect(within(dialogo).queryByLabelText("Buscar cliente no Portal")).not.toBeInTheDocument();
  });

  it("no sucesso, recarrega a tela e o estado passa a “vinculada” — sem reload da página", async () => {
    const organization = vi
      .spyOn(api, "organization")
      .mockResolvedValueOnce(organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO }))
      .mockResolvedValue(organizacao({ portal: fixtures.PORTAL_EMPRESA_VINCULADA }));
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71]));
    const vincular = vi.spyOn(api, "confirmPortalSelection").mockResolvedValue({
      publicId: "99999999-9999-4999-8999-999999999999",
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 71,
      status: "ACTIVE",
      alreadyLinked: false,
      clientName: "CLIENTE SINTETICO",
      clientDocumentMasked: "**.***.333/0001-81"
    });
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));
    await userEvent.click(await within(dialogo).findByLabelText("Selecionar EMPRESA SINTETICA LTDA"));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar vínculo" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Empresa vinculada ao Portal."));
    expect(vincular).toHaveBeenCalledWith(fixtures.ORG_PUBLIC_ID, 71);
    expect(organization.mock.calls.length).toBeGreaterThan(1);
    await waitFor(() =>
      expect(screen.getByTestId("portal-estado-empresa")).toHaveTextContent(/vinculada/i)
    );
  });

  it("repetição do mesmo vínculo é anunciada como idempotente, não como criação", async () => {
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71]));
    vi.spyOn(api, "confirmPortalSelection").mockResolvedValue({
      publicId: "99999999-9999-4999-8999-999999999999",
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 71,
      status: "ACTIVE",
      alreadyLinked: true,
      clientName: "CLIENTE SINTETICO",
      clientDocumentMasked: "**.***.333/0001-81"
    });
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));
    await userEvent.click(await within(dialogo).findByLabelText("Selecionar EMPRESA SINTETICA LTDA"));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar vínculo" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/já estava vinculada/i));
  });

  it.each([
    [409, "PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT", /já está vinculada a outro id de cliente/i],
    [409, "ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS", /já está vinculado a outra empresa/i],
    [409, "PORTAL_REFERENCE_AMBIGUOUS", /mais de um vínculo ativo com o Portal/i]
  ])("erro %s/%s vira frase compreensível, não o texto genérico do status", async (status, code, esperado) => {
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71]));
    vi.spyOn(api, "confirmPortalSelection").mockRejectedValue(
      new ApiError(status, code, "mensagem genérica do status")
    );
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));
    await userEvent.click(await within(dialogo).findByLabelText("Selecionar EMPRESA SINTETICA LTDA"));
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar vínculo" }));

    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByText("mensagem genérica do status")).not.toBeInTheDocument();
  });

  it("nenhuma resposta da tela mostra CNPJ inteiro", async () => {
    vi.spyOn(api, "portalCatalog").mockResolvedValue(catalogo([CLIENTE_71, CLIENTE_72]));
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("Buscar cliente no Portal"), "sintetica");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Buscar" }));
    await within(dialogo).findByLabelText("Selecionar EMPRESA SINTETICA LTDA");

    expect(document.body.textContent ?? "").not.toMatch(/\b\d{14}\b/);
  });
});

// ---------------------------------------------------------------------------
// Novo usuário — o gate na tela
// ---------------------------------------------------------------------------

describe("novo usuário — cobertura do Portal", () => {
  it("PCTEC_PORTAL sem cobertura bloqueia a criação e diz o que fazer", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO })
    );
    const criar = vi.spyOn(api, "createOrganizationUser");
    renderizar();
    const dialogo = await abrirNovoUsuario();
    await preencher(dialogo, ["PCTEC_PORTAL"]);

    expect(within(dialogo).getByTestId("portal-bloqueio")).toHaveTextContent(/ainda não está vinculada/i);
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeDisabled();
    expect(criar).not.toHaveBeenCalled();
  });

  it("grupo com cobertura incompleta bloqueia e lista as empresas pendentes", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ type: "BUSINESS_GROUP", portal: fixtures.PORTAL_GRUPO_PARCIAL })
    );
    renderizar();
    const dialogo = await abrirNovoUsuario();
    await preencher(dialogo, ["PCTEC_PORTAL"]);

    const bloqueio = within(dialogo).getByTestId("portal-bloqueio");
    expect(bloqueio).toHaveTextContent(/1/);
    expect(bloqueio).toHaveTextContent(/2/);
    expect(within(bloqueio).getByRole("link", { name: "EMPRESA PENDENTE LTDA" })).toHaveAttribute(
      "href",
      `/admin/organizacoes/${fixtures.EMPRESA_PENDENTE_PUBLIC_ID}`
    );
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeDisabled();
  });

  it("aplicações que não são o Portal continuam permitindo a criação", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO })
    );
    renderizar();
    const dialogo = await abrirNovoUsuario();
    await preencher(dialogo, ["APP_SINTETICA"]);

    expect(within(dialogo).queryByTestId("portal-bloqueio")).not.toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeEnabled();
  });

  it("com cobertura, PCTEC_PORTAL é liberado — e o convite continua opcional e marcado", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_VINCULADA })
    );
    renderizar();
    const dialogo = await abrirNovoUsuario();
    await preencher(dialogo, ["PCTEC_PORTAL"]);

    expect(within(dialogo).queryByTestId("portal-bloqueio")).not.toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeEnabled();

    const convite = within(dialogo).getByRole("checkbox", { name: /Gerar o convite de primeiro acesso agora/i });
    expect(convite).toBeChecked();
    await userEvent.click(convite);
    expect(convite).not.toBeChecked();
    // Desmarcar o convite nunca bloqueia a criação.
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeEnabled();
  });

  it("depois de vincular, o formulário deixa de bloquear PCTEC_PORTAL", async () => {
    vi.spyOn(api, "organization")
      .mockResolvedValueOnce(organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO }))
      .mockResolvedValue(organizacao({ portal: fixtures.PORTAL_EMPRESA_VINCULADA }));
    vi.spyOn(api, "confirmPortalSelection").mockResolvedValue({
      publicId: "99999999-9999-4999-8999-999999999999",
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 71,
      status: "ACTIVE",
      alreadyLinked: false,
      clientName: "CLIENTE SINTETICO",
      clientDocumentMasked: "**.***.333/0001-81"
    });
    renderizar();

    // Antes: bloqueado.
    const antes = await abrirNovoUsuario();
    await preencher(antes, ["PCTEC_PORTAL"]);
    expect(within(antes).getByRole("button", { name: "Criar usuário" })).toBeDisabled();
    await userEvent.click(within(antes).getByRole("button", { name: "Cancelar" }));

    // Vincula — pela sugestão automática, que é o caminho curto quando o
    // CNPJ bate com exatamente um cliente do Portal.
    vi.spyOn(api, "portalMatch").mockResolvedValue({
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      status: "EXACT_UNIQUE",
      hasDocument: true,
      candidateCount: 1,
      suggestion: {
        legacyId: 71,
        name: "CLIENTE SINTETICO",
        tradeName: null,
        documentMasked: "**.***.333/0001-81",
        active: true
      }
    } as never);
    await userEvent.click(screen.getByRole("button", { name: "Vincular ao Portal" }));
    const vinculo = await screen.findByRole("dialog", { name: "Vincular ao Portal" });
    const sugestao = await within(vinculo).findByTestId("portal-sugestao");
    await userEvent.click(within(sugestao).getByRole("button", { name: "Confirmar este cliente" }));
    await waitFor(() =>
      expect(screen.getByTestId("portal-estado-empresa")).toHaveTextContent(/vinculada/i)
    );

    // Depois: liberado.
    const depois = await abrirNovoUsuario();
    await preencher(depois, ["PCTEC_PORTAL"]);
    expect(within(depois).queryByTestId("portal-bloqueio")).not.toBeInTheDocument();
    expect(within(depois).getByRole("button", { name: "Criar usuário" })).toBeEnabled();
  });

  it("cobertura desconhecida não bloqueia — quem decide é o servidor", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(organizacao());
    renderizar();
    const dialogo = await abrirNovoUsuario();
    await preencher(dialogo, ["PCTEC_PORTAL"]);

    expect(within(dialogo).queryByTestId("portal-bloqueio")).not.toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Cadastro ambíguo — mais de um vínculo ativo
// ---------------------------------------------------------------------------

/**
 * Terceiro estado, e o único em que a tela não pode oferecer o vínculo.
 *
 * Tratar ambiguidade como "sem vínculo" mostraria o botão que agrava o
 * problema; tratá-la como "vinculada" exibiria um `legacyId` que ninguém
 * escolheu. As duas leituras estão erradas, e a tela precisa dizer a
 * terceira coisa.
 */
describe("cadastro ambíguo", () => {
  it("empresa com dois vínculos: nem “vinculada” nem “sem vínculo”, e sem botão de vincular", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_AMBIGUA })
    );
    renderizar();

    const estado = await screen.findByTestId("portal-estado-empresa");
    expect(estado).toHaveTextContent(/2 vínculos ativos/i);
    expect(estado).not.toHaveTextContent(/ainda não está vinculada/i);
    expect(screen.queryByRole("button", { name: "Vincular ao Portal" })).not.toBeInTheDocument();
    expect(screen.getByText(/equipe de plataforma/i)).toBeInTheDocument();
  });

  it("os dois vínculos são listados — nenhum é apresentado como “o” vínculo", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_AMBIGUA })
    );
    renderizar();

    await screen.findByTestId("portal-estado-empresa");
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.getByText("99")).toBeInTheDocument();
  });

  it("grupo com empresa ambígua mostra o conflito e o link para ela", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ type: "BUSINESS_GROUP", portal: fixtures.PORTAL_GRUPO_AMBIGUO })
    );
    renderizar();

    const aviso = await screen.findByTestId("portal-grupo-ambiguo");
    expect(aviso).toHaveTextContent(/mais de um vínculo ativo/i);
    expect(screen.getByRole("link", { name: "EMPRESA AMBIGUA LTDA" })).toHaveAttribute(
      "href",
      `/admin/organizacoes/${fixtures.EMPRESA_PENDENTE_PUBLIC_ID}`
    );
    // Não é caso de "faltam empresas": ninguém deve sair vinculando.
    expect(screen.queryByText(/Cobertura completa/i)).not.toBeInTheDocument();
  });

  it("novo usuário com PCTEC_PORTAL é bloqueado, e a orientação NÃO é “conclua o vínculo”", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_AMBIGUA })
    );
    const criar = vi.spyOn(api, "createOrganizationUser");
    renderizar();
    const dialogo = await abrirNovoUsuario();
    await preencher(dialogo, ["PCTEC_PORTAL"]);

    const bloqueio = within(dialogo).getByTestId("portal-bloqueio");
    expect(bloqueio).toHaveTextContent(/2 vínculos ativos/i);
    expect(bloqueio).toHaveTextContent(/equipe de plataforma/i);
    expect(bloqueio).not.toHaveTextContent(/Integração com o Portal/i);
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeDisabled();
    expect(criar).not.toHaveBeenCalled();
  });

  it("ambiguidade não afeta outras aplicações", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_AMBIGUA })
    );
    renderizar();
    const dialogo = await abrirNovoUsuario();
    await preencher(dialogo, ["APP_SINTETICA"]);

    expect(within(dialogo).queryByTestId("portal-bloqueio")).not.toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Criar usuário" })).toBeEnabled();
  });

  it("409 PORTAL_REFERENCE_AMBIGUOUS na criação do vínculo vira frase compreensível", async () => {
    // Chega quando o cadastro fica ambíguo entre o carregamento da tela e
    // o clique — a autoridade é o servidor, não o que a tela tinha em mãos.
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO })
    );
    vi.spyOn(api, "portalMatch").mockResolvedValue({
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      status: "EXACT_UNIQUE",
      hasDocument: true,
      candidateCount: 1,
      suggestion: {
        legacyId: 71,
        name: "CLIENTE SINTETICO",
        tradeName: null,
        documentMasked: "**.***.333/0001-81",
        active: true
      }
    } as never);
    vi.spyOn(api, "confirmPortalSelection").mockRejectedValue(
      new ApiError(409, "PORTAL_REFERENCE_AMBIGUOUS", "mensagem genérica do status")
    );
    renderizar();
    await userEvent.click(await screen.findByRole("button", { name: "Vincular ao Portal" }));
    const dialogo = await screen.findByRole("dialog", { name: "Vincular ao Portal" });

    // Mesmo pela sugestão automática, a recusa do servidor prevalece: a
    // correspondência por CNPJ não é permissão para escrever.
    const sugestao = await within(dialogo).findByTestId("portal-sugestao");
    await userEvent.click(within(sugestao).getByRole("button", { name: "Confirmar este cliente" }));

    expect(await screen.findByText(/mais de um vínculo ativo com o Portal/i)).toBeInTheDocument();
    expect(screen.queryByText("mensagem genérica do status")).not.toBeInTheDocument();
  });
});
