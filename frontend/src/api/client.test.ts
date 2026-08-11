import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch, ApiError, ApiNetworkError } from "./client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("apiFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolve com o corpo JSON em caso de sucesso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { identity: { publicId: "abc" }, session: { publicId: "s1" } }))
    );

    const result = await apiFetch<{ identity: { publicId: string } }>("/me");

    expect(result.identity.publicId).toBe("abc");
  });

  it("SEMPRE chama fetch com credentials:'include' — único mecanismo de sessão usado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/me");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/me"),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("erro HTTP com envelope real do backend -> ApiError com code extraído (I: base para tratamento de erro)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          jsonResponse(401, {
            error: { code: "SESSION_INVALID", message: "Sessão inválida.", correlation_id: "corr-1", details: [] }
          })
        )
      )
    );

    await expect(apiFetch("/me")).rejects.toMatchObject({
      status: 401,
      code: "SESSION_INVALID"
    });
    await expect(apiFetch("/me")).rejects.toBeInstanceOf(ApiError);
  });

  it("falha de rede real (fetch rejeita) -> ApiNetworkError, NUNCA um ApiError (I: distinção rede x erro de negócio)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    );

    await expect(apiFetch("/me")).rejects.toBeInstanceOf(ApiNetworkError);
    await expect(apiFetch("/me")).rejects.not.toBeInstanceOf(ApiError);
  });

  it("204 sem corpo (logout) resolve sem tentar parsear JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(apiFetch("/sessions/current", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("erro HTTP sem envelope reconhecido usa código genérico, nunca quebra", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } }))
    );

    await expect(apiFetch("/me")).rejects.toMatchObject({ status: 502, code: "UNKNOWN_ERROR" });
  });
});
