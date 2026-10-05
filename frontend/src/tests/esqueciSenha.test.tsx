import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { LoginPage } from "../pages/LoginPage.js";
import { EsqueciSenhaPage, MENSAGEM_MUITOS_PEDIDOS, MENSAGEM_PEDIDO_NEUTRO } from "../pages/EsqueciSenhaPage.js";
import { MENSAGEM_LINK_INDISPONIVEL, RedefinirSenhaPage } from "../pages/RedefinirSenhaPage.js";
import { descartarTokenDaRedefinicao } from "../tokenDaRedefinicao.js";

const TOKEN = "token-sintetico-de-redefinicao-abc123";
const SENHA = "senha-nova-sintetica-longa";

/** Mostra a rota atual — para conferir para onde a tela levou a pessoa. */
function OndeEstou(): JSX.Element {
  return <div data-testid="rota">{useLocation().pathname}</div>;
}

function renderizarEm(caminho: string, aoConcluir?: () => void) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <Routes>
        <Route path="/login" element={<LoginPage onAutenticado={async () => undefined} />} />
        <Route path="/esqueci-senha" element={<EsqueciSenhaPage />} />
        <Route
          path="/redefinir-senha"
          element={<RedefinirSenhaPage {...(aoConcluir !== undefined ? { aoConcluir } : {})} />}
        />
      </Routes>
      <OndeEstou />
    </MemoryRouter>
  );
}

/** A tela de redefinição lê o token da URL REAL (window.location), não do MemoryRouter. */
function abrirLinkDoEmail(fragmento = `#${TOKEN}`): void {
  window.history.replaceState(null, "", `/redefinir-senha${fragmento}`);
}

beforeEach(() => {
  descartarTokenDaRedefinicao();
  vi.spyOn(api, "solicitarRedefinicaoDeSenha").mockResolvedValue({ message: MENSAGEM_PEDIDO_NEUTRO });
  vi.spyOn(api, "previewRedefinicaoDeSenha").mockResolvedValue({ expiresAt: "2026-09-01T12:30:00.000Z" });
  vi.spyOn(api, "redefinirSenha").mockResolvedValue({ passwordReset: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  descartarTokenDaRedefinicao();
  window.history.replaceState(null, "", "/");
});

describe("tela de login", () => {
  it("oferece o link 'Esqueci minha senha', que leva ao formulário de pedido", async () => {
    renderizarEm("/login");

    await userEvent.click(screen.getByRole("link", { name: "Esqueci minha senha" }));

    expect(screen.getByTestId("rota")).toHaveTextContent("/esqueci-senha");
    expect(screen.getByRole("heading", { name: "Esqueci minha senha" })).toBeInTheDocument();
  });
});

describe("Esqueci minha senha — pedido", () => {
  it("envia o e-mail e mostra a mensagem neutra", async () => {
    renderizarEm("/esqueci-senha");

    await userEvent.type(screen.getByLabelText("E-mail"), "pessoa@example.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Enviar link de redefinição" }));

    expect(await screen.findByText(MENSAGEM_PEDIDO_NEUTRO)).toBeInTheDocument();
    expect(api.solicitarRedefinicaoDeSenha).toHaveBeenCalledWith("pessoa@example.invalid");
    expect(MENSAGEM_PEDIDO_NEUTRO).toBe(
      "Se este e-mail estiver cadastrado, enviaremos instruções para redefinir sua senha."
    );
  });

  it("a frase não depende do que o servidor responde no corpo", async () => {
    vi.spyOn(api, "solicitarRedefinicaoDeSenha").mockResolvedValue({ message: "qualquer outra coisa" });
    renderizarEm("/esqueci-senha");

    await userEvent.type(screen.getByLabelText("E-mail"), "ninguem@example.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Enviar link de redefinição" }));

    expect(await screen.findByText(MENSAGEM_PEDIDO_NEUTRO)).toBeInTheDocument();
    expect(screen.queryByText("qualquer outra coisa")).not.toBeInTheDocument();
  });

  it("mostra estado de envio enquanto espera", async () => {
    let liberar: () => void = () => undefined;
    vi.spyOn(api, "solicitarRedefinicaoDeSenha").mockImplementation(
      () => new Promise((resolve) => (liberar = () => resolve({ message: MENSAGEM_PEDIDO_NEUTRO })))
    );
    renderizarEm("/esqueci-senha");

    await userEvent.type(screen.getByLabelText("E-mail"), "pessoa@example.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Enviar link de redefinição" }));

    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();
    liberar();
    expect(await screen.findByText(MENSAGEM_PEDIDO_NEUTRO)).toBeInTheDocument();
  });

  it("limite de tentativas vira mensagem própria, e o formulário continua", async () => {
    vi.spyOn(api, "solicitarRedefinicaoDeSenha").mockRejectedValue(
      new ApiError(429, "PASSWORD_RESET_RATE_LIMITED", "x")
    );
    renderizarEm("/esqueci-senha");

    await userEvent.type(screen.getByLabelText("E-mail"), "pessoa@example.invalid");
    await userEvent.click(screen.getByRole("button", { name: "Enviar link de redefinição" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAGEM_MUITOS_PEDIDOS);
    expect(screen.getByLabelText("E-mail")).toBeInTheDocument();
  });
});

describe("Redefinir senha — link do e-mail", () => {
  it("o token sai da barra de endereço antes da primeira chamada", async () => {
    let hashNaChamada: string | null = null;
    vi.spyOn(api, "previewRedefinicaoDeSenha").mockImplementation(async (token: string) => {
      hashNaChamada = window.location.hash;
      expect(token).toBe(TOKEN);
      return { expiresAt: "2026-09-01T12:30:00.000Z" };
    });
    abrirLinkDoEmail();

    renderizarEm("/redefinir-senha");

    expect(window.location.hash).toBe("");
    await waitFor(() => expect(hashNaChamada).not.toBeNull());
    expect(hashNaChamada).toBe("");
  });

  it("mostra 'Verificando link…' enquanto confere o link", async () => {
    abrirLinkDoEmail();
    renderizarEm("/redefinir-senha");

    expect(screen.getByRole("status")).toHaveTextContent("Verificando link…");
    expect(await screen.findByLabelText("Nova senha")).toBeInTheDocument();
  });

  it("sucesso: troca a senha e leva ao login com mensagem de sucesso", async () => {
    const aoConcluir = vi.fn();
    abrirLinkDoEmail();
    renderizarEm("/redefinir-senha", aoConcluir);

    await userEvent.type(await screen.findByLabelText("Nova senha"), SENHA);
    await userEvent.type(screen.getByLabelText("Confirme a nova senha"), SENHA);
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(await screen.findByText(/Senha redefinida/)).toBeInTheDocument();
    expect(screen.getByTestId("rota")).toHaveTextContent("/login");
    expect(api.redefinirSenha).toHaveBeenCalledWith(TOKEN, SENHA, SENHA);
    expect(aoConcluir).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["expirado, usado ou inválido (401)", new ApiError(401, "PASSWORD_RESET_NOT_USABLE", "x")],
    ["sem resposta do servidor", new Error("rede")]
  ])("link %s: mensagem clara e oferta de novo link", async (_caso, falha) => {
    vi.spyOn(api, "previewRedefinicaoDeSenha").mockRejectedValue(falha);
    abrirLinkDoEmail();
    renderizarEm("/redefinir-senha");

    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAGEM_LINK_INDISPONIVEL);
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Solicitar novo link" }));
    expect(screen.getByTestId("rota")).toHaveTextContent("/esqueci-senha");
  });

  it("link sem token: indisponível sem nem consultar o servidor", async () => {
    abrirLinkDoEmail("");
    renderizarEm("/redefinir-senha");

    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAGEM_LINK_INDISPONIVEL);
    expect(api.previewRedefinicaoDeSenha).not.toHaveBeenCalled();
  });

  it("link que expira entre abrir e salvar: troca recusada vira a tela de link indisponível", async () => {
    vi.spyOn(api, "redefinirSenha").mockRejectedValue(new ApiError(401, "PASSWORD_RESET_NOT_USABLE", "x"));
    abrirLinkDoEmail();
    renderizarEm("/redefinir-senha");

    await userEvent.type(await screen.findByLabelText("Nova senha"), SENHA);
    await userEvent.type(screen.getByLabelText("Confirme a nova senha"), SENHA);
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(MENSAGEM_LINK_INDISPONIVEL);
    expect(screen.getByRole("link", { name: "Solicitar novo link" })).toBeInTheDocument();
  });

  it("confirmação diferente: avisa sem chamar o servidor", async () => {
    abrirLinkDoEmail();
    renderizarEm("/redefinir-senha");

    await userEvent.type(await screen.findByLabelText("Nova senha"), SENHA);
    await userEvent.type(screen.getByLabelText("Confirme a nova senha"), `${SENHA}-x`);
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(screen.getByRole("alert")).toHaveTextContent("A confirmação não confere");
    expect(api.redefinirSenha).not.toHaveBeenCalled();
  });

  it("senha curta: avisa a política sem chamar o servidor", async () => {
    abrirLinkDoEmail();
    renderizarEm("/redefinir-senha");

    await userEvent.type(await screen.findByLabelText("Nova senha"), "curta");
    await userEvent.type(screen.getByLabelText("Confirme a nova senha"), "curta");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(screen.getByRole("alert")).toHaveTextContent("pelo menos 12 caracteres");
    expect(api.redefinirSenha).not.toHaveBeenCalled();
  });

  it("política recusada pelo servidor (422): o link continua valendo e a pessoa tenta de novo", async () => {
    vi.spyOn(api, "redefinirSenha")
      .mockRejectedValueOnce(new ApiError(422, "CREDENTIAL_PASSWORD_POLICY_VIOLATION", "x"))
      .mockResolvedValueOnce({ passwordReset: true });
    abrirLinkDoEmail();
    renderizarEm("/redefinir-senha");

    await userEvent.type(await screen.findByLabelText("Nova senha"), "password123456");
    await userEvent.type(screen.getByLabelText("Confirme a nova senha"), "password123456");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("não pode ser uma senha comum");

    await userEvent.clear(screen.getByLabelText("Nova senha"));
    await userEvent.clear(screen.getByLabelText("Confirme a nova senha"));
    await userEvent.type(screen.getByLabelText("Nova senha"), SENHA);
    await userEvent.type(screen.getByLabelText("Confirme a nova senha"), SENHA);
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));

    expect(await screen.findByText(/Senha redefinida/)).toBeInTheDocument();
    expect(api.redefinirSenha).toHaveBeenLastCalledWith(TOKEN, SENHA, SENHA);
  });
});
