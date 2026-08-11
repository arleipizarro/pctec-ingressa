import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "../auth/AuthContext.js";
import { LoginPage } from "./LoginPage.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorBody(code: string) {
  return { error: { code, message: "erro", correlation_id: null, details: [] } };
}

async function renderLoginPage(bootstrapResponse: Response) {
  const fetchMock = vi.fn().mockResolvedValueOnce(bootstrapResponse);
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByRole("heading", { name: /Acessar o PCTEC Ingressa/i })).toBeInTheDocument());
  return fetchMock;
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("erro de autenticação (401 AUTHENTICATION_FAILED) mostra mensagem específica de credenciais", async () => {
    const fetchMock = await renderLoginPage(jsonResponse(401, errorBody("SESSION_INVALID")));
    fetchMock.mockResolvedValueOnce(jsonResponse(401, errorBody("AUTHENTICATION_FAILED")));

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/E-mail/i), "user@example.com");
    await user.type(screen.getByLabelText(/Senha/i), "senha-errada");
    await user.click(screen.getByRole("button", { name: /Entrar/i }));

    await waitFor(() => expect(screen.getByText("E-mail ou senha inválidos.")).toBeInTheDocument());
  });

  it("I) erro de rede mostra mensagem DISTINTA de 'senha inválida' — nunca confunde os dois", async () => {
    const fetchMock = await renderLoginPage(jsonResponse(401, errorBody("SESSION_INVALID")));
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/E-mail/i), "user@example.com");
    await user.type(screen.getByLabelText(/Senha/i), "qualquer-coisa");
    await user.click(screen.getByRole("button", { name: /Entrar/i }));

    await waitFor(() =>
      expect(screen.getByText(/Não foi possível contatar o servidor/i)).toBeInTheDocument()
    );
    expect(screen.queryByText("E-mail ou senha inválidos.")).not.toBeInTheDocument();
  });

  it("senha nunca permanece no campo depois que o submit termina (sucesso ou falha)", async () => {
    const fetchMock = await renderLoginPage(jsonResponse(401, errorBody("SESSION_INVALID")));
    fetchMock.mockResolvedValueOnce(jsonResponse(401, errorBody("AUTHENTICATION_FAILED")));

    const user = userEvent.setup();
    const passwordInput = screen.getByLabelText(/Senha/i) as HTMLInputElement;
    await user.type(screen.getByLabelText(/E-mail/i), "user@example.com");
    await user.type(passwordInput, "senha-temporaria");
    expect(passwordInput.value).toBe("senha-temporaria");

    await user.click(screen.getByRole("button", { name: /Entrar/i }));

    await waitFor(() => expect(screen.getByText("E-mail ou senha inválidos.")).toBeInTheDocument());
    expect(passwordInput.value).toBe("");
  });

  it("J/K) em nenhum momento credenciais/token são gravados em localStorage/sessionStorage, mesmo após tentativa de login", async () => {
    const fetchMock = await renderLoginPage(jsonResponse(401, errorBody("SESSION_INVALID")));
    fetchMock.mockResolvedValueOnce(jsonResponse(401, errorBody("AUTHENTICATION_FAILED")));

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/E-mail/i), "user@example.com");
    await user.type(screen.getByLabelText(/Senha/i), "senha-secreta");
    await user.click(screen.getByRole("button", { name: /Entrar/i }));

    await waitFor(() => expect(screen.getByText("E-mail ou senha inválidos.")).toBeInTheDocument());

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("usa a arte oficial exata (pctec-ingressa-logo.png) sem substituir por texto/SVG", async () => {
    await renderLoginPage(jsonResponse(401, errorBody("SESSION_INVALID")));

    const image = screen.getByAltText(/PCTEC Ingressa/i) as HTMLImageElement;
    expect(image.tagName).toBe("IMG");
    expect(image.src).toContain("pctec-ingressa-logo");
  });
});
