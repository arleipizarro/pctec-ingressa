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

describe("criação do vínculo", () => {
  async function abrirVinculo() {
    await userEvent.click(await screen.findByRole("button", { name: "Vincular ao Portal" }));
    return screen.findByRole("dialog", { name: "Vincular ao Portal" });
  }

  it("exige confirmação explícita e um inteiro positivo antes de habilitar", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO })
    );
    renderizar();
    const dialogo = await abrirVinculo();

    expect(within(dialogo).getByText(/todos os usuários do Portal desta empresa/i)).toBeInTheDocument();
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar vínculo" });
    expect(confirmar).toBeDisabled();

    await userEvent.type(within(dialogo).getByLabelText("ID do cliente no Portal"), "0");
    expect(confirmar).toBeDisabled();

    await userEvent.clear(within(dialogo).getByLabelText("ID do cliente no Portal"));
    await userEvent.type(within(dialogo).getByLabelText("ID do cliente no Portal"), "71");
    expect(confirmar).toBeEnabled();
  });

  it("no sucesso, recarrega a tela e o estado passa a “vinculada” — sem reload da página", async () => {
    const organization = vi
      .spyOn(api, "organization")
      .mockResolvedValueOnce(organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO }))
      .mockResolvedValue(organizacao({ portal: fixtures.PORTAL_EMPRESA_VINCULADA }));
    const vincular = vi.spyOn(api, "linkPortalReference").mockResolvedValue({
      publicId: "99999999-9999-4999-8999-999999999999",
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 71,
      status: "ACTIVE",
      alreadyLinked: false
    });
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("ID do cliente no Portal"), "71");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar vínculo" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Empresa vinculada ao Portal."));
    expect(vincular).toHaveBeenCalledWith(fixtures.ORG_PUBLIC_ID, 71);
    expect(organization.mock.calls.length).toBeGreaterThan(1);
    await waitFor(() =>
      expect(screen.getByTestId("portal-estado-empresa")).toHaveTextContent(/vinculada/i)
    );
  });

  it("repetição do mesmo vínculo é anunciada como idempotente, não como criação", async () => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO })
    );
    vi.spyOn(api, "linkPortalReference").mockResolvedValue({
      publicId: "99999999-9999-4999-8999-999999999999",
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 71,
      status: "ACTIVE",
      alreadyLinked: true
    });
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("ID do cliente no Portal"), "71");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar vínculo" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/já estava vinculada/i));
  });

  it.each([
    [
      409,
      "PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT",
      /já está vinculada a outro id de cliente/i
    ],
    [
      409,
      "ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS",
      /já está vinculado a outra empresa/i
    ],
    // A frase precisa ser distinguível da dica do formulário, que também
    // fala em "número inteiro positivo".
    [422, "PORTAL_REFERENCE_LEGACY_ID_INVALID", /Informe o id do cliente no Portal como um número/i]
  ])("erro %s/%s vira frase compreensível, não o texto genérico do status", async (status, code, esperado) => {
    vi.spyOn(api, "organization").mockResolvedValue(
      organizacao({ portal: fixtures.PORTAL_EMPRESA_SEM_VINCULO })
    );
    vi.spyOn(api, "linkPortalReference").mockRejectedValue(
      new ApiError(status, code, "mensagem genérica do status")
    );
    renderizar();
    const dialogo = await abrirVinculo();

    await userEvent.type(within(dialogo).getByLabelText("ID do cliente no Portal"), "71");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar vínculo" }));

    // O modal fica aberto para a pessoa corrigir — e ele tem o próprio
    // aviso. Por isso a asserção é sobre o texto, não sobre "o alert".
    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByText("mensagem genérica do status")).not.toBeInTheDocument();
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
    vi.spyOn(api, "linkPortalReference").mockResolvedValue({
      publicId: "99999999-9999-4999-8999-999999999999",
      organizationPublicId: fixtures.ORG_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 71,
      status: "ACTIVE",
      alreadyLinked: false
    });
    renderizar();

    // Antes: bloqueado.
    const antes = await abrirNovoUsuario();
    await preencher(antes, ["PCTEC_PORTAL"]);
    expect(within(antes).getByRole("button", { name: "Criar usuário" })).toBeDisabled();
    await userEvent.click(within(antes).getByRole("button", { name: "Cancelar" }));

    // Vincula.
    await userEvent.click(screen.getByRole("button", { name: "Vincular ao Portal" }));
    const vinculo = await screen.findByRole("dialog", { name: "Vincular ao Portal" });
    await userEvent.type(within(vinculo).getByLabelText("ID do cliente no Portal"), "71");
    await userEvent.click(within(vinculo).getByRole("button", { name: "Confirmar vínculo" }));
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
    vi.spyOn(api, "linkPortalReference").mockRejectedValue(
      new ApiError(409, "PORTAL_REFERENCE_AMBIGUOUS", "mensagem genérica do status")
    );
    renderizar();
    await userEvent.click(await screen.findByRole("button", { name: "Vincular ao Portal" }));
    const dialogo = await screen.findByRole("dialog", { name: "Vincular ao Portal" });

    await userEvent.type(within(dialogo).getByLabelText("ID do cliente no Portal"), "71");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar vínculo" }));

    expect(await screen.findByText(/mais de um vínculo ativo com o Portal/i)).toBeInTheDocument();
    expect(screen.queryByText("mensagem genérica do status")).not.toBeInTheDocument();
  });
});
