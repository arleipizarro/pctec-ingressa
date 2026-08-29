import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import * as fixtures from "./fixtures.js";

/**
 * Painel "Meus aplicativos".
 *
 * A invariante que estes testes protegem: **a tela desenha o que o
 * servidor autorizou, e nada além.** Card ausente significa acesso
 * ausente; a UI não filtra, não decide perfil e não inventa destino.
 */

const NOME = "Pessoa Sintetica";
const PORTAL_START = "https://portal.example.invalid/api/auth/ingressa/start";

const CARD_PORTAL = { code: "PCTEC_PORTAL", name: "PCTEC Portal", profile: "USER", launchUrl: PORTAL_START };
const CARD_ADMIN = { code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" };
const CARD_HELPDESK = { code: "PCTEC_HELPDESK", name: "PCTEC Helpdesk", profile: "USER", launchUrl: null };

const ORGS = [
  { publicId: "aaaa1111-1111-4111-8111-111111111111", type: "BUSINESS_GROUP", legalName: "GRUPO SINTETICO", tradeName: null },
  { publicId: "bbbb2222-2222-4222-8222-222222222222", type: "COMPANY", legalName: "EMPRESA SINTETICA LTDA", tradeName: "Empresa Sintetica" }
];

function painel(applications: readonly unknown[]) {
  return { identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: NOME }, applications } as never;
}

function renderizar(rota = "/apps") {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>
  );
}

const erroDaApi = (status: number) => new ApiError(status, "X", "falhou");

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_PORTAL, CARD_HELPDESK]));
  vi.spyOn(api, "organizacoes").mockResolvedValue({ organizations: ORGS } as never);
  vi.spyOn(api, "summary").mockResolvedValue(fixtures.RESUMO);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cards seguem exclusivamente o ApplicationAccess", () => {
  it("mostra apenas as aplicações concedidas", async () => {
    renderizar();
    await screen.findByText("Portal do Cliente");

    // Escopo na SEÇÃO de aplicativos: "PCTEC Ingressa" também é o título
    // da marca no cabeçalho, e procurá-lo no documento inteiro mediria a
    // coisa errada.
    const aplicativos = within(screen.getByRole("region", { name: "Suas aplicações PCTEC" }));
    expect(aplicativos.getByText("Portal do Cliente")).toBeInTheDocument();
    expect(aplicativos.getByText("PCTEC Helpdesk")).toBeInTheDocument();
    // Não concedida → não existe card.
    expect(aplicativos.queryByText("PCTEC Ingressa")).not.toBeInTheDocument();
  });

  it("acesso revogado deixa de aparecer — a tela reflete a resposta, não um estado próprio", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_HELPDESK]));
    renderizar();

    expect(await screen.findByText("PCTEC Helpdesk")).toBeInTheDocument();
    expect(screen.queryByText("Portal do Cliente")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acessar Portal do Cliente" })).not.toBeInTheDocument();
  });

  it("sem nenhum acesso, explica o que fazer em vez de mostrar tela vazia", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([]));
    renderizar();

    expect(await screen.findByText(/não tem acesso a nenhum aplicativo/i)).toBeInTheDocument();
  });
});

describe("ações dos cards", () => {
  it("Portal abre pelo fluxo SSO existente — link nativo para o start do Portal", async () => {
    renderizar();

    const acao = await screen.findByRole("link", { name: "Acessar Portal do Cliente" });
    expect(acao).toHaveAttribute("href", PORTAL_START);
  });

  it("a tela nunca monta authorize, state ou PKCE — só segue a URL do servidor", async () => {
    renderizar();
    await screen.findByRole("link", { name: "Acessar Portal do Cliente" });

    const html = document.body.innerHTML;
    expect(html).not.toContain("code_challenge");
    expect(html).not.toContain("/sso/authorize");
    expect(html).not.toContain("state=");
  });

  it("Helpdesk sem destino mostra 'Indisponível no momento' — nenhuma URL inventada", async () => {
    renderizar();
    await screen.findByText("PCTEC Helpdesk");

    expect(screen.getByText("Indisponível no momento")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acessar PCTEC Helpdesk" })).not.toBeInTheDocument();
  });

  it("Helpdesk COM destino configurado ganha o botão de acesso", async () => {
    const comDestino = { ...CARD_HELPDESK, launchUrl: "https://helpdesk.example.invalid/entrar" };
    vi.spyOn(api, "apps").mockResolvedValue(painel([comDestino]));
    renderizar();

    expect(await screen.findByRole("link", { name: "Acessar PCTEC Helpdesk" }))
      .toHaveAttribute("href", "https://helpdesk.example.invalid/entrar");
  });
});

describe("cards de aplicação — apresentação", () => {
  const CARD_DESCONHECIDO = {
    code: "PCTEC_FUTURO",
    name: "PCTEC Futuro",
    profile: "USER",
    launchUrl: "https://futuro.example.invalid/entrar"
  };

  it("aplicação conhecida ganha nome amigável, descrição e perfil traduzido", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_PORTAL, CARD_HELPDESK]));
    renderizar();

    const secao = within(await screen.findByRole("region", { name: "Suas aplicações PCTEC" }));
    expect(secao.getByRole("heading", { name: "Portal do Cliente", level: 3 })).toBeInTheDocument();
    expect(secao.getByText(/Acompanhe contratos, equipamentos, informações financeiras e chamados/i))
      .toBeInTheDocument();
    expect(secao.getByRole("heading", { name: "PCTEC Helpdesk", level: 3 })).toBeInTheDocument();
    expect(secao.getByText(/Registre e acompanhe solicitações, dúvidas e incidentes/i)).toBeInTheDocument();
    // Perfil traduzido, nunca o enum cru.
    expect(secao.getAllByText(/Perfil · Usuário/).length).toBe(2);
    expect(secao.queryByText(/\bUSER\b/)).not.toBeInTheDocument();
  });

  it("o subtítulo diz que a lista é do perfil, não um catálogo de produtos", async () => {
    renderizar();
    expect(await screen.findByText(/somente os sistemas liberados para o seu perfil/i)).toBeInTheDocument();
  });

  it("aplicação desconhecida continua visível, com card genérico e o nome do servidor", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_DESCONHECIDO]));
    renderizar();

    const secao = within(await screen.findByRole("region", { name: "Suas aplicações PCTEC" }));
    // Aparece porque o servidor autorizou — a tela não filtra por catálogo.
    expect(secao.getByRole("heading", { name: "PCTEC Futuro", level: 3 })).toBeInTheDocument();
    expect(secao.getByText(/liberada para o seu perfil/i)).toBeInTheDocument();
    // E continua clicável, com a URL do servidor intacta.
    expect(secao.getByRole("link", { name: "Acessar PCTEC Futuro" }))
      .toHaveAttribute("href", CARD_DESCONHECIDO.launchUrl);
  });

  it("o código técnico é informação secundária — nunca o título do card", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_PORTAL]));
    renderizar();

    const secao = within(await screen.findByRole("region", { name: "Suas aplicações PCTEC" }));
    // Presente para suporte...
    expect(secao.getByText("PCTEC_PORTAL")).toBeInTheDocument();
    // ...mas o título é o nome amigável, não o código.
    const titulo = secao.getByRole("heading", { level: 3 });
    expect(titulo).toHaveTextContent("Portal do Cliente");
    expect(titulo).not.toHaveTextContent("PCTEC_PORTAL");
  });

  it("aplicação acessível mostra selo Disponível e o botão de acesso", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_PORTAL]));
    renderizar();

    const secao = within(await screen.findByRole("region", { name: "Suas aplicações PCTEC" }));
    expect(secao.getByText("Disponível")).toBeInTheDocument();
    expect(secao.getByRole("link", { name: "Acessar Portal do Cliente" })).toHaveTextContent("Acessar aplicação");
  });

  it("sem URL não há link algum — nem quebrado, nem vazio", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_HELPDESK]));
    renderizar();

    const secao = within(await screen.findByRole("region", { name: "Suas aplicações PCTEC" }));
    expect(secao.getByText("Indisponível")).toBeInTheDocument();
    expect(secao.getByText("Indisponível no momento")).toBeInTheDocument();
    expect(secao.queryAllByRole("link")).toHaveLength(0);
    // O card NÃO some: o acesso existe, o destino é que não está pronto.
    expect(secao.getByRole("heading", { name: "PCTEC Helpdesk", level: 3 })).toBeInTheDocument();
  });

  it("a URL do servidor é preservada byte a byte, com query e tudo", async () => {
    const comQuery = { ...CARD_PORTAL, launchUrl: `${PORTAL_START}?origem=ingressa&x=1` };
    vi.spyOn(api, "apps").mockResolvedValue(painel([comQuery]));
    renderizar();

    expect(await screen.findByRole("link", { name: "Acessar Portal do Cliente" }))
      .toHaveAttribute("href", `${PORTAL_START}?origem=ingressa&x=1`);
  });

  it("destino externo continua na MESMA aba — sem target nem window.open", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_PORTAL]));
    renderizar();

    const acao = await screen.findByRole("link", { name: "Acessar Portal do Cliente" });
    expect(acao).not.toHaveAttribute("target");
    expect(acao).not.toHaveAttribute("rel");
  });

  it("a ação é alcançável por teclado e recebe foco", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_PORTAL]));
    renderizar();

    const acao = await screen.findByRole("link", { name: "Acessar Portal do Cliente" });
    await userEvent.tab();
    // Tabula até chegar na ação: ela está na ordem natural do documento.
    for (let i = 0; i < 12 && document.activeElement !== acao; i += 1) {
      await userEvent.tab();
    }
    expect(acao).toHaveFocus();
  });
});

describe("separação entre usuário e administração", () => {
  it("USER não vê nada de administração no launcher", async () => {
    renderizar();
    await screen.findByText("Portal do Cliente");

    expect(screen.queryByText("Administrador")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acessar PCTEC Ingressa" })).not.toBeInTheDocument();
    expect(screen.queryByText("Usuários")).not.toBeInTheDocument();
    expect(screen.queryByText("Organizações")).not.toBeInTheDocument();
  });

  it("USER que força /admin volta para o launcher", async () => {
    renderizar("/admin");

    expect(await screen.findByText("Meus aplicativos")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Painel" })).not.toBeInTheDocument();
  });

  it("ADMIN vê o selo e o caminho para a administração", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_ADMIN, CARD_PORTAL]));
    renderizar();

    expect(await screen.findByText("Administrador")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acessar PCTEC Ingressa" })).toHaveAttribute("href", "/admin");
  });

  it("ADMIN continua alcançando as rotas administrativas existentes", async () => {
    vi.spyOn(api, "apps").mockResolvedValue(painel([CARD_ADMIN]));
    vi.spyOn(api, "identities").mockResolvedValue(fixtures.PAGINA_IDENTIDADES);
    renderizar("/admin/usuarios");

    expect(await screen.findByRole("heading", { name: "Usuários" })).toBeInTheDocument();
  });
});

describe("empresas com membership ACTIVE", () => {
  it("lista as organizações do usuário", async () => {
    renderizar();

    await screen.findByText("GRUPO SINTETICO");
    const empresas = within(screen.getByRole("region", { name: "Suas empresas" }));
    expect(empresas.getByText("GRUPO SINTETICO")).toBeInTheDocument();
    expect(empresas.getByText("Empresa Sintetica")).toBeInTheDocument();
    expect(empresas.getByText("Grupo")).toBeInTheDocument();
  });

  it("sem vínculo, diz isso em vez de sumir com a seção", async () => {
    vi.spyOn(api, "organizacoes").mockResolvedValue({ organizations: [] } as never);
    renderizar();

    expect(await screen.findByText(/não está vinculado a nenhuma empresa/i)).toBeInTheDocument();
  });

  it("403 não é erro: é a rota de contexto do Portal recusando quem não tem Portal", async () => {
    vi.spyOn(api, "organizacoes").mockRejectedValue(erroDaApi(403));
    renderizar();

    expect(await screen.findByText(/fica disponível para quem tem acesso ao PCTEC Portal/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falha real mostra erro e oferece nova tentativa", async () => {
    const chamada = vi.spyOn(api, "organizacoes").mockRejectedValue(erroDaApi(500));
    renderizar();

    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível carregar suas empresas/i);

    chamada.mockResolvedValue({ organizations: ORGS } as never);
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText("GRUPO SINTETICO")).toBeInTheDocument();
  });

  it("mostra o estado de carregamento enquanto busca", async () => {
    vi.spyOn(api, "organizacoes").mockImplementation(() => new Promise(() => undefined));
    renderizar();

    expect(await screen.findByText(/carregando suas empresas/i)).toBeInTheDocument();
  });
});

describe("cabeçalho e logout", () => {
  it("mostra o nome de quem está logado, nunca o publicId", async () => {
    renderizar();

    expect(await screen.findByText(NOME)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(fixtures.ADMIN_PUBLIC_ID.slice(0, 8));
  });

  it("sair encerra a sessão no servidor e volta ao login", async () => {
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);
    renderizar();

    await userEvent.click(await screen.findByRole("button", { name: "Sair" }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByLabelText("E-mail")).toBeInTheDocument();
  });

  it("falha no logout do servidor não prende a pessoa na tela", async () => {
    vi.spyOn(api, "logout").mockRejectedValue(erroDaApi(500));
    renderizar();

    await userEvent.click(await screen.findByRole("button", { name: "Sair" }));

    expect(await screen.findByLabelText("E-mail")).toBeInTheDocument();
  });

  it("erro do SSO devolvido pelo Ingressa aparece como aviso", async () => {
    renderizar("/apps?sso_erro=acesso_negado&app=PCTEC_PORTAL");

    const aviso = await screen.findByRole("alert");
    expect(within(aviso).getByText(/PCTEC_PORTAL/)).toBeInTheDocument();
  });
});
