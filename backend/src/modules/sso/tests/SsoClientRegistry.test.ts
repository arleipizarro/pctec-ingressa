import { describe, expect, it } from "vitest";
import { SsoClientRegistry } from "../domain/SsoClientRegistry.js";
import { SsoAuthorizationRequestInvalidError } from "../domain/errors/SsoErrors.js";

const REDIRECT = "https://portal.example.invalid/api/auth/ingressa/callback";
const registry = new SsoClientRegistry([
  { clientId: "PCTEC_PORTAL", redirectUris: [REDIRECT], launchUrl: "https://portal.example.invalid/start" }
]);

describe("registro de clientes SSO", () => {
  it("aceita o par exato (client_id, redirect_uri) registrado", () => {
    expect(registry.requireClientWithRedirectUri("PCTEC_PORTAL", REDIRECT).clientId).toBe("PCTEC_PORTAL");
  });

  it("client_id desconhecido é recusado", () => {
    expect(() => registry.requireClientWithRedirectUri("OUTRO", REDIRECT)).toThrow(SsoAuthorizationRequestInvalidError);
  });

  it.each([
    ["https://atacante.example.invalid/callback", "host completamente diferente"],
    ["https://portal.example.invalid.atacante.example.invalid/api/auth/ingressa/callback", "sufixo enganoso"],
    ["https://portal.example.invalid/api/auth/ingressa/callback/", "barra final a mais"],
    ["https://portal.example.invalid/api/auth/ingressa/callback?x=1", "query extra"],
    ["http://portal.example.invalid/api/auth/ingressa/callback", "esquema rebaixado para http"]
  ])("recusa redirect_uri não registrado: %s (%s)", (candidato) => {
    expect(() => registry.requireClientWithRedirectUri("PCTEC_PORTAL", candidato)).toThrow(
      SsoAuthorizationRequestInvalidError
    );
  });

  it("cliente sem redirect_uri configurado simplesmente não existe — fail-closed", () => {
    const vazio = new SsoClientRegistry([]);
    expect(vazio.find("PCTEC_PORTAL")).toBeUndefined();
    expect(() => vazio.requireClientWithRedirectUri("PCTEC_PORTAL", REDIRECT)).toThrow(
      SsoAuthorizationRequestInvalidError
    );
  });

  it("a mensagem externa nunca conta qual dos dois parâmetros estava errado", () => {
    const porCliente = capturar(() => registry.requireClientWithRedirectUri("OUTRO", REDIRECT));
    const porRedirect = capturar(() => registry.requireClientWithRedirectUri("PCTEC_PORTAL", "https://x.invalid/cb"));
    expect(porCliente.message).toBe(porRedirect.message);
    // O motivo interno, por outro lado, distingue — é o que serve ao log.
    expect((porCliente as SsoAuthorizationRequestInvalidError).reason).not.toBe(
      (porRedirect as SsoAuthorizationRequestInvalidError).reason
    );
  });
});

function capturar(acao: () => unknown): Error {
  try {
    acao();
  } catch (erro) {
    return erro as Error;
  }
  throw new Error("esperava uma exceção");
}
