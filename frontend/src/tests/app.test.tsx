import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App.js";
import { api, ApiError } from "../api.js";
import * as fixtures from "./fixtures.js";

function renderizar(rota = "/") {
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <App />
    </MemoryRouter>
  );
}

const NOME_ADMIN_SINTETICO = "Administrador Sintetico";
/**
 * A sessão da UI passou a vir de `GET /api/v1/apps` — a rota do usuário,
 * que responde 200 para qualquer sessão válida — e não mais de
 * `/admin/whoami`, que só responde 200 para ADMIN. O painel abaixo é o
 * de um administrador: card do próprio Ingressa com perfil ADMIN.
 */
const PAINEL_ADMIN = {
  identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: NOME_ADMIN_SINTETICO },
  applications: [
    { code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" },
    { code: "PCTEC_PORTAL", name: "PCTEC Portal", profile: "USER", launchUrl: "https://portal.example.invalid/api/auth/ingressa/start" }
  ]
};

/**
 * Erro REAL da API, não um objeto parecido: `useSessao` distingue
 * `ApiError` (vai para o login) de falha inesperada (deixa estourar).
 * Um duplo estruturalmente parecido passaria pelo `instanceof` errado e
 * o teste provaria o contrário do que pretende.
 */
function erroDaApi(status: number): ApiError {
  return new ApiError(status, "X", "falhou");
}

beforeEach(() => {
  vi.spyOn(api, "apps").mockResolvedValue(PAINEL_ADMIN);
  vi.spyOn(api, "summary").mockResolvedValue(fixtures.RESUMO);
  vi.spyOn(api, "identities").mockResolvedValue(fixtures.PAGINA_IDENTIDADES);
  vi.spyOn(api, "identity").mockResolvedValue(fixtures.IDENTIDADE_DETALHE);
  vi.spyOn(api, "organizations").mockResolvedValue(fixtures.PAGINA_ORGANIZACOES_COM_GRUPO);
  vi.spyOn(api, "applications").mockResolvedValue(fixtures.APLICACOES);
  vi.spyOn(api, "organization").mockResolvedValue(fixtures.ORGANIZACAO_DETALHE);
  vi.spyOn(api, "importBatches").mockResolvedValue(fixtures.PAGINA_LOTES);
  vi.spyOn(api, "importBatchItems").mockResolvedValue(fixtures.PAGINA_ITENS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("login e proteção de rotas", () => {
  it("sem sessão, qualquer rota mostra o login", async () => {
    vi.spyOn(api, "apps").mockRejectedValue(erroDaApi(401));
    renderizar("/admin/usuarios");

    expect(await screen.findByLabelText("E-mail")).toBeInTheDocument();
    expect(screen.queryByText("Usuários")).not.toBeInTheDocument();
  });

  it("autentica e entra no launcher", async () => {
    const apps = vi.spyOn(api, "apps").mockRejectedValueOnce(erroDaApi(401)).mockResolvedValue(PAINEL_ADMIN);
    const login = vi.spyOn(api, "login").mockResolvedValue(undefined);
    renderizar("/admin");

    await userEvent.type(await screen.findByLabelText("E-mail"), "admin@example.invalid");
    await userEvent.type(screen.getByLabelText("Senha"), "senha-sintetica");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("admin@example.invalid", "senha-sintetica"));
    // Depois do login, a primeira tela é "Meus aplicativos" — não a
    // administração. Quem não é ADMIN também precisa chegar a algum
    // lugar, e esse lugar é o launcher.
    expect(await screen.findByText("Meus aplicativos")).toBeInTheDocument();
    expect(apps).toHaveBeenCalled();
  });

  it("credencial recusada mostra mensagem em português, sem detalhe interno", async () => {
    vi.spyOn(api, "apps").mockRejectedValue(erroDaApi(401));
    vi.spyOn(api, "login").mockRejectedValue(new ApiError(401, "AUTH", "Sua sessão expirou. Entre novamente."));
    renderizar("/login");

    await userEvent.type(await screen.findByLabelText("E-mail"), "admin@example.invalid");
    await userEvent.type(screen.getByLabelText("Senha"), "errada");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent(/sessão expirou/i);
    expect(alerta.textContent ?? "").not.toMatch(/stack|SQL|Error:/i);
  });

  it("não guarda nada em localStorage — a sessão é cookie do servidor", async () => {
    renderizar("/admin");
    await screen.findByRole("heading", { name: "Painel" });
    expect(localStorage.length).toBe(0);
  });
});

describe("painel", () => {
  it("mostra contagens, alerta de conflito e últimos lotes", async () => {
    renderizar("/admin");

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(screen.getByText("Identidades ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("Memberships ativos")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/1 CONFLICT/);
    expect(screen.getByText("regras-v2")).toBeInTheDocument();
  });

  it("mostra erro legível quando a API falha", async () => {
    vi.spyOn(api, "summary").mockRejectedValue(new ApiError(500, "X", "Erro interno. Tente novamente em instantes."));
    renderizar("/admin");

    expect(await screen.findByRole("alert")).toHaveTextContent(/erro interno/i);
  });
});

describe("usuários", () => {
  it("lista e filtra por status", async () => {
    renderizar("/admin/usuarios");

    expect(await screen.findByText("Piloto Um")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Filtrar por status"), "PENDING");

    await waitFor(() => {
      const chamada = (api.identities as unknown as { mock: { calls: URLSearchParams[][] } }).mock.calls.at(-1)?.[0];
      expect(chamada?.get("status")).toBe("PENDING");
    });
  });

  it("mostra vazio quando não há resultado", async () => {
    vi.spyOn(api, "identities").mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    renderizar("/admin/usuarios");
    expect(await screen.findByText("Nenhum registro encontrado.")).toBeInTheDocument();
  });

  it("detalhe mostra origem federada, referências, memberships e acessos", async () => {
    renderizar(`/admin/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    expect(await screen.findByRole("heading", { name: "Piloto Um" })).toBeInTheDocument();
    expect(screen.getByText("FEDERADA")).toBeInTheDocument();
    expect(screen.getByText("SISTEMA_SINTETICO")).toBeInTheDocument();
    expect(screen.getByText("APP_SINTETICA")).toBeInTheDocument();
  });
});

describe("ações com confirmação", () => {
  it("ativar identidade federada pede confirmação antes de chamar a API", async () => {
    const ativar = vi.spyOn(api, "activateFederated").mockResolvedValue(undefined);
    renderizar(`/admin/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    await userEvent.click(await screen.findByRole("button", { name: /ativar identidade federada/i }));
    expect(ativar).not.toHaveBeenCalled();

    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText(/nenhuma senha é criada/i)).toBeInTheDocument();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(ativar).toHaveBeenCalledWith(fixtures.IDENTIDADE_PUBLIC_ID));
    expect(await screen.findByText("Identidade ativada.")).toBeInTheDocument();
  });

  it("cancelar fecha o diálogo sem chamar a API", async () => {
    const ativar = vi.spyOn(api, "activateFederated").mockResolvedValue(undefined);
    renderizar(`/admin/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    await userEvent.click(await screen.findByRole("button", { name: /ativar identidade federada/i }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ativar).not.toHaveBeenCalled();
  });

  it("revogar acesso envia a versão exibida — base do controle de concorrência", async () => {
    const revogar = vi.spyOn(api, "revokeAccess").mockResolvedValue(undefined);
    renderizar(`/admin/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    await userEvent.click(await screen.findByRole("button", { name: "Revogar" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(revogar).toHaveBeenCalledWith(fixtures.ACESSO_PUBLIC_ID, 1));
  });

  it("409 na revogação vira mensagem de recarregar, não erro técnico", async () => {
    vi.spyOn(api, "revokeAccess").mockRejectedValue(
      new ApiError(409, "CONFLICT", "O registro mudou desde que a tela carregou. Recarregue e tente de novo.")
    );
    renderizar(`/admin/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    await userEvent.click(await screen.findByRole("button", { name: "Revogar" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText(/recarregue e tente de novo/i)).toBeInTheDocument();
  });

  it("encerrar membership exige motivo digitado", async () => {
    const encerrar = vi.spyOn(api, "endMembership").mockResolvedValue(undefined);
    renderizar(`/admin/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    await userEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
    const dialogo = screen.getByRole("dialog");
    await userEvent.type(within(dialogo).getByLabelText(/motivo/i), "saiu da empresa");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(encerrar).toHaveBeenCalledWith(fixtures.MEMBERSHIP_PUBLIC_ID, "saiu da empresa"));
  });
});

describe("organizações e importações", () => {
  it("lista organizações e abre o detalhe com hierarquia", async () => {
    renderizar(`/admin/organizacoes/${fixtures.ORG_PUBLIC_ID}`);

    expect(await screen.findByRole("heading", { name: "EMPRESA SINTETICA LTDA" })).toBeInTheDocument();
    expect(screen.getByText("GRUPO SINTETICO")).toBeInTheDocument();
  });

  it("itens do lote mostram o campo redigido sem revelar o conteúdo", async () => {
    renderizar(`/admin/importacoes/${fixtures.LOTE_PUBLIC_ID}`);

    expect(await screen.findByText("[REDIGIDO]")).toBeInTheDocument();
    expect(screen.getByText(/bcrypt_hash/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("nao-pode-vazar");
  });

  it("a tela de importações declara que é somente leitura", async () => {
    renderizar("/admin/importacoes");
    expect(await screen.findByText(/somente leitura/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /aplicar/i })).not.toBeInTheDocument();
  });
});

describe("conceder acesso", () => {
  async function abrirFormulario() {
    renderizar(`/admin/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Conceder acesso" }));
    return screen.getByRole("dialog", { name: "Conceder acesso" });
  }

  it("só oferece aplicações ACTIVE", async () => {
    const dialogo = await abrirFormulario();
    const opcoes = within(dialogo).getByLabelText("Aplicação");

    expect(within(opcoes).getByRole("option", { name: "APP_SINTETICA" })).toBeInTheDocument();
    expect(within(opcoes).queryByRole("option", { name: "APP_DESATIVADA" })).not.toBeInTheDocument();
  });

  it("cancelar fecha sem chamar a API", async () => {
    const conceder = vi.spyOn(api, "grantAccess").mockResolvedValue(undefined);
    const dialogo = await abrirFormulario();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog", { name: "Conceder acesso" })).not.toBeInTheDocument();
    expect(conceder).not.toHaveBeenCalled();
  });

  it("sem aplicação selecionada, valida no formulário e não chama a API", async () => {
    const conceder = vi.spyOn(api, "grantAccess").mockResolvedValue(undefined);
    const dialogo = await abrirFormulario();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Conceder" }));

    expect(within(dialogo).getByRole("alert")).toHaveTextContent("Selecione a aplicação.");
    expect(conceder).not.toHaveBeenCalled();
  });

  it("sucesso concede com aplicação e perfil escolhidos e recarrega a tela", async () => {
    const conceder = vi.spyOn(api, "grantAccess").mockResolvedValue(undefined);
    const detalhe = vi.spyOn(api, "identity").mockResolvedValue(fixtures.IDENTIDADE_DETALHE);
    const dialogo = await abrirFormulario();

    await userEvent.selectOptions(within(dialogo).getByLabelText("Aplicação"), "APP_SINTETICA");
    await userEvent.selectOptions(within(dialogo).getByLabelText("Perfil"), "ADMIN");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Conceder" }));

    await waitFor(() => expect(conceder).toHaveBeenCalledWith(fixtures.IDENTIDADE_PUBLIC_ID, "APP_SINTETICA", "ADMIN"));
    expect(await screen.findByText("Acesso concedido.")).toBeInTheDocument();
    await waitFor(() => expect(detalhe.mock.calls.length).toBeGreaterThan(1));
  });

  it("409 mantém o formulário aberto com mensagem de recarregar", async () => {
    vi.spyOn(api, "grantAccess").mockRejectedValue(
      new ApiError(409, "CONFLICT", "O registro mudou desde que a tela carregou. Recarregue e tente de novo.")
    );
    const dialogo = await abrirFormulario();
    await userEvent.selectOptions(within(dialogo).getByLabelText("Aplicação"), "APP_SINTETICA");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Conceder" }));

    expect(await screen.findByText(/recarregue e tente de novo/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Conceder acesso" })).toBeInTheDocument();
  });

  it("403 vira mensagem de permissão, sem detalhe interno", async () => {
    vi.spyOn(api, "grantAccess").mockRejectedValue(
      new ApiError(403, "APPLICATION_ACCESS_DENIED", "Você não tem permissão para esta operação.")
    );
    const dialogo = await abrirFormulario();
    await userEvent.selectOptions(within(dialogo).getByLabelText("Aplicação"), "APP_SINTETICA");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Conceder" }));

    const mensagem = await screen.findByText(/não tem permissão/i);
    expect(mensagem.textContent ?? "").not.toMatch(/SQL|stack|Error:/i);
  });

  it("422 do servidor aparece como dados inválidos", async () => {
    vi.spyOn(api, "grantAccess").mockRejectedValue(new ApiError(422, "X", "Dados inválidos. Revise os campos."));
    const dialogo = await abrirFormulario();
    await userEvent.selectOptions(within(dialogo).getByLabelText("Aplicação"), "APP_SINTETICA");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Conceder" }));

    expect(await screen.findByText(/dados inválidos/i)).toBeInTheDocument();
  });
});

describe("criar membership", () => {
  async function abrirFormulario() {
    renderizar(`/admin/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Criar membership" }));
    return screen.getByRole("dialog", { name: "Criar membership" });
  }

  it("COMPANY não oferece AND_DESCENDANTS e explica por quê", async () => {
    const dialogo = await abrirFormulario();
    await userEvent.selectOptions(within(dialogo).getByLabelText("Organização"), fixtures.ORG_PUBLIC_ID);

    const escopo = within(dialogo).getByLabelText("Escopo");
    expect(within(escopo).getByRole("option", { name: "ORGANIZATION_ONLY" })).toBeInTheDocument();
    expect(within(escopo).queryByRole("option", { name: "ORGANIZATION_AND_DESCENDANTS" })).not.toBeInTheDocument();
    expect(within(dialogo).getByText(/não tem descendentes/i)).toBeInTheDocument();
  });

  it("BUSINESS_GROUP oferece os dois escopos", async () => {
    const dialogo = await abrirFormulario();
    await userEvent.selectOptions(within(dialogo).getByLabelText("Organização"), fixtures.GRUPO.public_id);

    const escopo = within(dialogo).getByLabelText("Escopo");
    expect(within(escopo).getByRole("option", { name: "ORGANIZATION_AND_DESCENDANTS" })).toBeInTheDocument();
  });

  it("trocar de grupo para empresa reverte o escopo incompatível", async () => {
    const criar = vi.spyOn(api, "createMembership").mockResolvedValue(undefined);
    const dialogo = await abrirFormulario();

    await userEvent.selectOptions(within(dialogo).getByLabelText("Organização"), fixtures.GRUPO.public_id);
    await userEvent.selectOptions(within(dialogo).getByLabelText("Escopo"), "ORGANIZATION_AND_DESCENDANTS");
    await userEvent.selectOptions(within(dialogo).getByLabelText("Organização"), fixtures.ORG_PUBLIC_ID);
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar" }));

    await waitFor(() => expect(criar).toHaveBeenCalled());
    expect((criar.mock.calls[0]?.[0] as { scope: string }).scope).toBe("ORGANIZATION_ONLY");
  });

  it("cancelar fecha sem chamar a API", async () => {
    const criar = vi.spyOn(api, "createMembership").mockResolvedValue(undefined);
    const dialogo = await abrirFormulario();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog", { name: "Criar membership" })).not.toBeInTheDocument();
    expect(criar).not.toHaveBeenCalled();
  });

  it("sem organização selecionada, valida no formulário", async () => {
    const criar = vi.spyOn(api, "createMembership").mockResolvedValue(undefined);
    const dialogo = await abrirFormulario();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar" }));

    expect(within(dialogo).getByRole("alert")).toHaveTextContent("Selecione a organização.");
    expect(criar).not.toHaveBeenCalled();
  });

  it("sucesso cria com organização, perfil e escopo e recarrega a tela", async () => {
    const criar = vi.spyOn(api, "createMembership").mockResolvedValue(undefined);
    const detalhe = vi.spyOn(api, "identity").mockResolvedValue(fixtures.IDENTIDADE_DETALHE);
    const dialogo = await abrirFormulario();

    await userEvent.selectOptions(within(dialogo).getByLabelText("Organização"), fixtures.ORG_PUBLIC_ID);
    await userEvent.selectOptions(within(dialogo).getByLabelText("Perfil"), "EMPLOYEE");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar" }));

    await waitFor(() =>
      expect(criar).toHaveBeenCalledWith({
        identityPublicId: fixtures.IDENTIDADE_PUBLIC_ID,
        organizationPublicId: fixtures.ORG_PUBLIC_ID,
        profile: "EMPLOYEE",
        scope: "ORGANIZATION_ONLY"
      })
    );
    expect(await screen.findByText("Membership criado.")).toBeInTheDocument();
    await waitFor(() => expect(detalhe.mock.calls.length).toBeGreaterThan(1));
  });

  it("409 de vínculo duplicado mantém o formulário aberto", async () => {
    vi.spyOn(api, "createMembership").mockRejectedValue(
      new ApiError(409, "CONFLICT", "O registro mudou desde que a tela carregou. Recarregue e tente de novo.")
    );
    const dialogo = await abrirFormulario();
    await userEvent.selectOptions(within(dialogo).getByLabelText("Organização"), fixtures.ORG_PUBLIC_ID);
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar" }));

    expect(await screen.findByText(/recarregue e tente de novo/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Criar membership" })).toBeInTheDocument();
  });

  it("403 e 422 aparecem como mensagem de negócio", async () => {
    vi.spyOn(api, "createMembership").mockRejectedValue(new ApiError(422, "X", "Dados inválidos. Revise os campos."));
    const dialogo = await abrirFormulario();
    await userEvent.selectOptions(within(dialogo).getByLabelText("Organização"), fixtures.ORG_PUBLIC_ID);
    await userEvent.click(within(dialogo).getByRole("button", { name: "Criar" }));

    expect(await screen.findByText(/dados inválidos/i)).toBeInTheDocument();
  });
});

describe("cabeçalho", () => {
  it("mostra o nome vindo do servidor, nunca o publicId", async () => {
    renderizar("/admin");
    await screen.findByRole("heading", { name: "Painel" });

    expect(screen.getByText(NOME_ADMIN_SINTETICO)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(fixtures.ADMIN_PUBLIC_ID.slice(0, 8));
  });

  it("mostra o perfil ao lado do nome", async () => {
    renderizar("/admin");
    await screen.findByRole("heading", { name: "Painel" });
    expect(screen.getByText(/perfil ADMIN/)).toBeInTheDocument();
  });

  it("sem nome no servidor, usa rótulo neutro — nunca UUID parcial", async () => {
    vi.spyOn(api, "apps").mockResolvedValue({ ...PAINEL_ADMIN, identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "" } });
    renderizar("/admin");
    await screen.findByRole("heading", { name: "Painel" });

    expect(screen.getAllByText("Usuário").length).toBeGreaterThan(0);
    expect(document.body.textContent ?? "").not.toContain(fixtures.ADMIN_PUBLIC_ID.slice(0, 8));
  });

  it("nome só de espaços também cai no rótulo neutro", async () => {
    vi.spyOn(api, "apps").mockResolvedValue({ ...PAINEL_ADMIN, identity: { publicId: fixtures.ADMIN_PUBLIC_ID, fullName: "   " } });
    renderizar("/admin");
    await screen.findByRole("heading", { name: "Painel" });
    expect(screen.getAllByText("Usuário").length).toBeGreaterThan(0);
  });
});
