import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { App } from "./App.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorBody(code: string) {
  return { error: { code, message: "erro", correlation_id: null, details: [] } };
}

describe("App — composição completa", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("A) sem sessão -> renderiza a tela de login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, errorBody("SESSION_INVALID"))));

    render(<App />);

    await waitFor(() => expect(screen.getByRole("heading", { name: /Acessar o PCTEC Ingressa/i })).toBeInTheDocument());
  });

  it("G) sessão válida + 403 APPLICATION_ACCESS_DENIED no /portal/context -> tela de acesso não autorizado", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { identity: { publicId: "id-1" }, session: { publicId: "s1" } }));
    fetchMock.mockResolvedValueOnce(jsonResponse(403, errorBody("APPLICATION_ACCESS_DENIED")));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByText(/Acesso ao Portal não autorizado/i)).toBeInTheDocument());
  });

  it("I) erro de rede no bootstrap -> tela de erro técnico com opção de tentar novamente, e o retry de fato refaz a chamada", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Tentar novamente/i })).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce(jsonResponse(401, errorBody("SESSION_INVALID")));
    fireEvent.click(screen.getByRole("button", { name: /Tentar novamente/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: /Acessar o PCTEC Ingressa/i })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("E + Shell/Dashboard) sessão válida + 1 organization -> chega ao Dashboard mostrando dados reais", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { identity: { publicId: "id-real-1" }, session: { publicId: "s1" } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        identity: { publicId: "id-real-1" },
        organizations: [{ publicId: "org-real-1", type: "COMPANY", legalName: "Empresa Real LTDA", tradeName: "Empresa Real" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByText("Bem-vindo ao PCTEC Ingressa")).toBeInTheDocument());
    expect(screen.getAllByText("Empresa Real").length).toBeGreaterThan(0);
    expect(screen.getAllByText("id-real-1").length).toBeGreaterThan(0);
  });

  it("K) o HTML renderizado do shell/dashboard NUNCA contém legacyId/internalId/documentNumber/CNPJ/Credential/token/senha", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { identity: { publicId: "id-real-1" }, session: { publicId: "s1" } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        identity: { publicId: "id-real-1" },
        organizations: [{ publicId: "org-real-1", type: "COMPANY", legalName: "Empresa Real LTDA", tradeName: "Empresa Real" }]
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByText("Bem-vindo ao PCTEC Ingressa")).toBeInTheDocument());

    const html = container.innerHTML.toLowerCase();
    for (const forbidden of ["legacyid", "internalid", "documentnumber", "cnpj", "credential", "senha123", "password123"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("0 organizations -> estado vazio dentro do shell, NUNCA a tela de 403", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { identity: { publicId: "id-1" }, session: { publicId: "s1" } }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { identity: { publicId: "id-1" }, organizations: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByText(/Nenhuma organização vinculada/i)).toBeInTheDocument());
    expect(screen.queryByText(/Acesso ao Portal não autorizado/i)).not.toBeInTheDocument();
  });
});
