import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import { SESSION_COOKIE_NAME } from "../../../security/http/sessionCookie.js";
import { SessionValidationFailedError } from "../../../security/domain/errors/SessionValidationErrors.js";
import type { AuthenticatedPrincipal, ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { IssueAuthorizationCodeService } from "../../application/IssueAuthorizationCodeService.js";
import type { ExchangeAuthorizationCodeService } from "../../application/ExchangeAuthorizationCodeService.js";
import { SsoAuthorizationDeniedError } from "../../domain/errors/SsoErrors.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../../../portal/http/requireServiceCredential.js";

const IDENTIDADE = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const REDIRECT_URI = "https://portal.example.invalid/api/auth/ingressa/callback";
const DESAFIO = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const ESTADO = "estado-sintetico-1234";
const CREDENCIAL = "credencial-de-servico-sintetica";

const PRINCIPAL: AuthenticatedPrincipal = {
  identityPublicId: IDENTIDADE,
  sessionPublicId: "22222222-2222-2222-2222-222222222222"
};

class FakeValidateSessionService {
  public shouldFail = false;
  public async execute(): Promise<AuthenticatedPrincipal> {
    if (this.shouldFail) {
      throw new SessionValidationFailedError("SESSION_NOT_FOUND");
    }
    return PRINCIPAL;
  }
}

class FakeIssueAuthorizationCodeService {
  public shouldDeny = false;
  public chamadas: unknown[] = [];
  public async execute(request: unknown): Promise<{ code: string; expiresAt: Date; correlationId: string }> {
    this.chamadas.push(request);
    if (this.shouldDeny) {
      throw new SsoAuthorizationDeniedError("NO_USABLE_MEMBERSHIP");
    }
    return { code: "codigo-opaco-sintetico", expiresAt: new Date(Date.now() + 60_000), correlationId: "corr" };
  }
}

class FakeExchangeAuthorizationCodeService {
  public chamadas: Array<Record<string, unknown>> = [];
  public async execute(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.chamadas.push(request);
    return {
      identityPublicId: IDENTIDADE,
      fullName: "Pessoa Sintetica",
      applicationCode: "PCTEC_PORTAL",
      accessProfile: "USER",
      correlationId: "corr"
    };
  }
}

function urlDeAutorizacao(parametros: Partial<Record<string, string>> = {}): string {
  const query = new URLSearchParams({
    client_id: "PCTEC_PORTAL",
    redirect_uri: REDIRECT_URI,
    state: ESTADO,
    code_challenge: DESAFIO,
    code_challenge_method: "S256",
    ...parametros
  });
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor === undefined) {
      query.delete(chave);
    }
  }
  return `/api/v1/sso/authorize?${query.toString()}`;
}

describe("SSO — fronteira HTTP", () => {
  let server: Server;
  let baseUrl: string;
  let validateSessionService: FakeValidateSessionService;
  let issue: FakeIssueAuthorizationCodeService;
  let exchange: FakeExchangeAuthorizationCodeService;

  beforeEach(async () => {
    process.env["SSO_PORTAL_REDIRECT_URIS"] = REDIRECT_URI;
    process.env["SSO_PORTAL_LAUNCH_URL"] = "https://portal.example.invalid/api/auth/ingressa/start";
    validateSessionService = new FakeValidateSessionService();
    issue = new FakeIssueAuthorizationCodeService();
    exchange = new FakeExchangeAuthorizationCodeService();

    const app = createApp({
      validateSessionService: validateSessionService as unknown as ValidateSessionService,
      issueAuthorizationCodeService: issue as unknown as IssueAuthorizationCodeService,
      exchangeAuthorizationCodeService: exchange as unknown as ExchangeAuthorizationCodeService,
      serviceCredential: CREDENCIAL
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("endereço inesperado do servidor de teste");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    delete process.env["SSO_PORTAL_REDIRECT_URIS"];
    delete process.env["SSO_PORTAL_LAUNCH_URL"];
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe("GET /api/v1/sso/authorize", () => {
    it("com sessão válida, redireciona ao redirect_uri com code e state — e nada mais", async () => {
      const res = await fetch(`${baseUrl}${urlDeAutorizacao()}`, {
        redirect: "manual",
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
      });

      expect(res.status).toBe(302);
      const destino = new URL(res.headers.get("location") ?? "");
      expect(destino.origin + destino.pathname).toBe(REDIRECT_URI);
      expect(destino.searchParams.get("code")).toBe("codigo-opaco-sintetico");
      // `state` volta EXATAMENTE como veio.
      expect(destino.searchParams.get("state")).toBe(ESTADO);
      expect([...destino.searchParams.keys()].sort()).toEqual(["code", "state"]);
    });

    it("a URL de retorno NUNCA carrega identidade, sessão, perfil ou contexto", async () => {
      const res = await fetch(`${baseUrl}${urlDeAutorizacao()}`, {
        redirect: "manual",
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
      });

      const location = res.headers.get("location") ?? "";
      expect(location).not.toContain(IDENTIDADE);
      expect(location).not.toContain("token-valido");
      expect(location).not.toContain(PRINCIPAL.sessionPublicId);
      expect(location.toLowerCase()).not.toContain("jwt");
      expect(location.toLowerCase()).not.toContain("profile");
    });

    it.each([
      ["https://atacante.example.invalid/roubo", "host de terceiro"],
      ["https://portal.example.invalid/api/auth/ingressa/callback/", "barra final a mais"],
      ["//atacante.example.invalid", "URL protocolo-relativa"]
    ])("OPEN REDIRECT: redirect_uri não registrado responde 400 e NUNCA redireciona (%s)", async (candidato) => {
      const res = await fetch(`${baseUrl}${urlDeAutorizacao({ redirect_uri: candidato })}`, {
        redirect: "manual",
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
      });

      expect(res.status).toBe(422);
      expect(res.headers.get("location")).toBeNull();
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("SSO_AUTHORIZATION_REQUEST_INVALID");
    });

    it("client_id desconhecido responde 400 sem redirecionar", async () => {
      const res = await fetch(`${baseUrl}${urlDeAutorizacao({ client_id: "OUTRO" })}`, {
        redirect: "manual",
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
      });
      expect(res.status).toBe(422);
      expect(res.headers.get("location")).toBeNull();
    });

    it("PKCE ausente ou com método 'plain' é recusado", async () => {
      for (const parametros of [{ code_challenge_method: "plain" }, { code_challenge: "" }]) {
        const res = await fetch(`${baseUrl}${urlDeAutorizacao(parametros)}`, {
          redirect: "manual",
          headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
        });
        expect(res.status).toBe(422);
        expect(res.headers.get("location")).toBeNull();
      }
    });

    it("state ausente é recusado — sem state não há como o cliente detectar CSRF de login", async () => {
      const res = await fetch(`${baseUrl}${urlDeAutorizacao({ state: "" })}`, {
        redirect: "manual",
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
      });
      expect(res.status).toBe(422);
    });

    it("sem cookie, manda ao login com o retorno preservado — e nunca emite código", async () => {
      const res = await fetch(`${baseUrl}${urlDeAutorizacao()}`, { redirect: "manual" });

      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location.startsWith("/login?next=")).toBe(true);
      const next = decodeURIComponent(location.slice("/login?next=".length));
      expect(next.startsWith("/api/v1/sso/authorize?")).toBe(true);
      expect(issue.chamadas).toHaveLength(0);
    });

    it("sessão inválida também vai para o login, nunca 401 em JSON", async () => {
      validateSessionService.shouldFail = true;
      const res = await fetch(`${baseUrl}${urlDeAutorizacao()}`, {
        redirect: "manual",
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-expirado` }
      });

      expect(res.status).toBe(302);
      expect((res.headers.get("location") ?? "").startsWith("/login?next=")).toBe(true);
    });

    it("acesso negado volta ao launcher, NUNCA ao redirect_uri do cliente", async () => {
      issue.shouldDeny = true;
      const res = await fetch(`${baseUrl}${urlDeAutorizacao()}`, {
        redirect: "manual",
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-valido` }
      });

      expect(res.status).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location.startsWith("/apps?")).toBe(true);
      expect(location).not.toContain("portal.example.invalid");
    });
  });

  describe("POST /api/v1/service/sso/token", () => {
    const corpo = {
      client_id: "PCTEC_PORTAL",
      code: "codigo-opaco-sintetico",
      code_verifier: "verificador-sintetico-com-quarenta-e-tres-caracteres",
      redirect_uri: REDIRECT_URI
    };

    it("sem a credencial de serviço, 401 — e nunca chega ao caso de uso", async () => {
      const res = await fetch(`${baseUrl}/api/v1/service/sso/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo)
      });

      expect(res.status).toBe(401);
      expect(exchange.chamadas).toHaveLength(0);
    });

    it("com a credencial, devolve o payload mínimo do contrato", async () => {
      const res = await fetch(`${baseUrl}/api/v1/service/sso/token`, {
        method: "POST",
        headers: { "content-type": "application/json", [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL },
        body: JSON.stringify(corpo)
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["access", "application", "correlationId", "identity"]);
      // Nada de token, cookie, hash ou memberships atravessa a fronteira.
      const serializado = JSON.stringify(body);
      expect(serializado).not.toContain("codigo-opaco-sintetico");
      expect(serializado).not.toContain("verificador");
      expect(serializado).not.toContain("organizations");
    });

    it("cookie de sessão NÃO substitui a credencial de serviço neste namespace", async () => {
      const res = await fetch(`${baseUrl}/api/v1/service/sso/token`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE_NAME}=token-valido` },
        body: JSON.stringify(corpo)
      });

      expect(res.status).toBe(401);
      expect(exchange.chamadas).toHaveLength(0);
    });

    it("redirect_uri não registrado é recusado antes de qualquer consumo de código", async () => {
      const res = await fetch(`${baseUrl}/api/v1/service/sso/token`, {
        method: "POST",
        headers: { "content-type": "application/json", [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL },
        body: JSON.stringify({ ...corpo, redirect_uri: "https://atacante.example.invalid/cb" })
      });

      expect(res.status).toBe(401);
      expect(exchange.chamadas).toHaveLength(0);
    });
  });
});
