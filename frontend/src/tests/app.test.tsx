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

const SESSAO_ADMIN = { identity: { publicId: fixtures.ADMIN_PUBLIC_ID }, access: { profile: "ADMIN" } };

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
  vi.spyOn(api, "whoami").mockResolvedValue(SESSAO_ADMIN);
  vi.spyOn(api, "summary").mockResolvedValue(fixtures.RESUMO);
  vi.spyOn(api, "identities").mockResolvedValue(fixtures.PAGINA_IDENTIDADES);
  vi.spyOn(api, "identity").mockResolvedValue(fixtures.IDENTIDADE_DETALHE);
  vi.spyOn(api, "organizations").mockResolvedValue(fixtures.PAGINA_ORGANIZACOES);
  vi.spyOn(api, "organization").mockResolvedValue(fixtures.ORGANIZACAO_DETALHE);
  vi.spyOn(api, "importBatches").mockResolvedValue(fixtures.PAGINA_LOTES);
  vi.spyOn(api, "importBatchItems").mockResolvedValue(fixtures.PAGINA_ITENS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("login e proteção de rotas", () => {
  it("sem sessão, qualquer rota mostra o login", async () => {
    vi.spyOn(api, "whoami").mockRejectedValue(erroDaApi(401));
    renderizar("/usuarios");

    expect(await screen.findByLabelText("E-mail")).toBeInTheDocument();
    expect(screen.queryByText("Usuários")).not.toBeInTheDocument();
  });

  it("autentica e entra no painel", async () => {
    const whoami = vi.spyOn(api, "whoami").mockRejectedValueOnce(erroDaApi(401)).mockResolvedValue(SESSAO_ADMIN);
    const login = vi.spyOn(api, "login").mockResolvedValue(undefined);
    renderizar("/");

    await userEvent.type(await screen.findByLabelText("E-mail"), "admin@example.invalid");
    await userEvent.type(screen.getByLabelText("Senha"), "senha-sintetica");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("admin@example.invalid", "senha-sintetica"));
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(whoami).toHaveBeenCalled();
  });

  it("credencial recusada mostra mensagem em português, sem detalhe interno", async () => {
    vi.spyOn(api, "whoami").mockRejectedValue(erroDaApi(401));
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
    renderizar("/");
    await screen.findByRole("heading", { name: "Painel" });
    expect(localStorage.length).toBe(0);
  });
});

describe("painel", () => {
  it("mostra contagens, alerta de conflito e últimos lotes", async () => {
    renderizar("/");

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(screen.getByText("Identidades ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("Memberships ativos")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/1 CONFLICT/);
    expect(screen.getByText("regras-v2")).toBeInTheDocument();
  });

  it("mostra erro legível quando a API falha", async () => {
    vi.spyOn(api, "summary").mockRejectedValue(new ApiError(500, "X", "Erro interno. Tente novamente em instantes."));
    renderizar("/");

    expect(await screen.findByRole("alert")).toHaveTextContent(/erro interno/i);
  });
});

describe("usuários", () => {
  it("lista e filtra por status", async () => {
    renderizar("/usuarios");

    expect(await screen.findByText("Piloto Um")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Filtrar por status"), "PENDING");

    await waitFor(() => {
      const chamada = (api.identities as unknown as { mock: { calls: URLSearchParams[][] } }).mock.calls.at(-1)?.[0];
      expect(chamada?.get("status")).toBe("PENDING");
    });
  });

  it("mostra vazio quando não há resultado", async () => {
    vi.spyOn(api, "identities").mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    renderizar("/usuarios");
    expect(await screen.findByText("Nenhum registro encontrado.")).toBeInTheDocument();
  });

  it("detalhe mostra origem federada, referências, memberships e acessos", async () => {
    renderizar(`/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    expect(await screen.findByRole("heading", { name: "Piloto Um" })).toBeInTheDocument();
    expect(screen.getByText("FEDERADA")).toBeInTheDocument();
    expect(screen.getByText("SISTEMA_SINTETICO")).toBeInTheDocument();
    expect(screen.getByText("APP_SINTETICA")).toBeInTheDocument();
  });
});

describe("ações com confirmação", () => {
  it("ativar identidade federada pede confirmação antes de chamar a API", async () => {
    const ativar = vi.spyOn(api, "activateFederated").mockResolvedValue(undefined);
    renderizar(`/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

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
    renderizar(`/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    await userEvent.click(await screen.findByRole("button", { name: /ativar identidade federada/i }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ativar).not.toHaveBeenCalled();
  });

  it("revogar acesso envia a versão exibida — base do controle de concorrência", async () => {
    const revogar = vi.spyOn(api, "revokeAccess").mockResolvedValue(undefined);
    renderizar(`/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    await userEvent.click(await screen.findByRole("button", { name: "Revogar" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(revogar).toHaveBeenCalledWith(fixtures.ACESSO_PUBLIC_ID, 1));
  });

  it("409 na revogação vira mensagem de recarregar, não erro técnico", async () => {
    vi.spyOn(api, "revokeAccess").mockRejectedValue(
      new ApiError(409, "CONFLICT", "O registro mudou desde que a tela carregou. Recarregue e tente de novo.")
    );
    renderizar(`/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    await userEvent.click(await screen.findByRole("button", { name: "Revogar" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText(/recarregue e tente de novo/i)).toBeInTheDocument();
  });

  it("encerrar membership exige motivo digitado", async () => {
    const encerrar = vi.spyOn(api, "endMembership").mockResolvedValue(undefined);
    renderizar(`/usuarios/${fixtures.IDENTIDADE_PUBLIC_ID}`);

    await userEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
    const dialogo = screen.getByRole("dialog");
    await userEvent.type(within(dialogo).getByLabelText(/motivo/i), "saiu da empresa");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(encerrar).toHaveBeenCalledWith(fixtures.MEMBERSHIP_PUBLIC_ID, "saiu da empresa"));
  });
});

describe("organizações e importações", () => {
  it("lista organizações e abre o detalhe com hierarquia", async () => {
    renderizar(`/organizacoes/${fixtures.ORG_PUBLIC_ID}`);

    expect(await screen.findByRole("heading", { name: "EMPRESA SINTETICA LTDA" })).toBeInTheDocument();
    expect(screen.getByText("GRUPO SINTETICO")).toBeInTheDocument();
  });

  it("itens do lote mostram o campo redigido sem revelar o conteúdo", async () => {
    renderizar(`/importacoes/${fixtures.LOTE_PUBLIC_ID}`);

    expect(await screen.findByText("[REDIGIDO]")).toBeInTheDocument();
    expect(screen.getByText(/bcrypt_hash/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("nao-pode-vazar");
  });

  it("a tela de importações declara que é somente leitura", async () => {
    renderizar("/importacoes");
    expect(await screen.findByText(/somente leitura/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /aplicar/i })).not.toBeInTheDocument();
  });
});
