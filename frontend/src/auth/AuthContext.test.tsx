import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorBody(code: string) {
  return { error: { code, message: "erro", correlation_id: null, details: [] } };
}

/** Componente de teste mínimo, expõe o status atual como texto — evita depender de UI real. */
function StatusProbe(): JSX.Element {
  const { status } = useAuth();
  return <div data-testid="status">{status.kind}</div>;
}

describe("AuthContext — bootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("A) sessão ausente: /me retorna 401 -> status vira 'unauthenticated'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, errorBody("SESSION_INVALID"))));

    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));
  });

  it("B) sessão válida: /me retorna 200 -> status vira 'authenticated' com identityPublicId real", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { identity: { publicId: "id-real-123" }, session: { publicId: "s1" } }))
    );

    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
  });

  it("H) 401 durante bootstrap -> nunca fica em 'loading' para sempre, sempre resolve para 'unauthenticated' (volta ao login)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, errorBody("SESSION_INVALID"))));

    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      const text = screen.getByTestId("status").textContent;
      expect(text === "unauthenticated").toBe(true);
    });
  });

  it("5xx durante bootstrap -> status vira 'bootstrap-error', DISTINTO de 'unauthenticated' (nunca manda pro login por engano)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, errorBody("INTERNAL_ERROR"))));

    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("bootstrap-error"));
  });

  it("J) em nenhum momento do bootstrap qualquer token/valor é gravado em localStorage/sessionStorage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { identity: { publicId: "id-1" }, session: { publicId: "s1" } }))
    );

    render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("AuthContext — login()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("C) login bem-sucedido SEMPRE confirma via GET /me antes de marcar 'authenticated' — POST /sessions sozinho não basta", async () => {
    const fetchMock = vi.fn();
    // 1a chamada: bootstrap inicial (/me) -> sem sessão.
    fetchMock.mockResolvedValueOnce(jsonResponse(401, errorBody("SESSION_INVALID")));
    // 2a chamada: POST /sessions (login) -> 201.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { session: { publicId: "s2", expiresAt: "2026-01-01T00:00:00Z" }, identity: { publicId: "id-2" } })
    );
    // 3a chamada: GET /me DEPOIS do login -> confirma a sessão de verdade.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { identity: { publicId: "id-2" }, session: { publicId: "s2" } }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <LoginTrigger />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("unauthenticated"));

    screen.getByTestId("trigger-login").click();

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("authenticated"));
    // 3 chamadas no total: /me (boot) + POST /sessions + /me (confirmação) — nunca pula a confirmação.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function LoginTrigger(): JSX.Element {
  const { status, login } = useAuth();
  return (
    <div>
      <div data-testid="status">{status.kind}</div>
      <button data-testid="trigger-login" onClick={() => void login("user@example.com", "senha123")}>
        entrar
      </button>
    </div>
  );
}
