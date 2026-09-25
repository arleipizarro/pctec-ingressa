/**
 * `/api/v1/service/central-servicos/*` e a verificação no namespace do
 * Helpdesk — isolamento de credencial e contrato fechado na aplicação.
 */
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import type { ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { GetPortalContextService } from "../../../portal/application/GetPortalContextService.js";
import type { AuthorizeApplicationAccessService } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../../../portal/application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import type { CentralServicosService } from "../../application/CentralServicosService.js";
import { CentralServicosIdentityNotAuthorizedError } from "../../application/errors/CentralServicosErrors.js";
import {
  HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME,
  SERVICE_CREDENTIAL_HEADER_NAME
} from "../../../portal/http/requireServiceCredential.js";
import { MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME } from "../../../identity/http/identityResolutionServiceConsumers.js";
import {
  APPLICATION_CODE_POR_CONSUMIDOR,
  buildSsoTokenServiceConsumers,
  CENTRAL_SERVICOS_SERVICE_CREDENTIAL_HEADER_NAME
} from "../../../sso/http/ssoTokenServiceConsumers.js";
import { composeSso } from "../../../sso/infrastructure/SsoComposition.js";
import { SESSION_COOKIE_NAME } from "../../../security/http/sessionCookie.js";

const CRED = {
  central: "segredo-de-teste-central",
  portal: "segredo-de-teste-portal",
  helpdesk: "segredo-de-teste-helpdesk",
  meuRh: "segredo-de-teste-meu-rh"
};
const PESSOA = "22222222-2222-4222-8222-000000000001";

class FakeService {
  chamadas: string[] = [];
  async autorizacao(id: string) {
    this.chamadas.push(`autorizacao:${id}`);
    return { identityPublicId: id, fullName: "Fulana", accessProfile: "USER", roles: ["N1_OPERADOR"] };
  }
  async emitirAssercao(e: { identityPublicId: unknown }) {
    this.chamadas.push("emitir");
    if (e.identityPublicId !== PESSOA) throw new CentralServicosIdentityNotAuthorizedError();
    return { assertion: "t".repeat(43), assertionPublicId: "p", expiresAt: "2026-09-25T13:00:00.000Z" };
  }
  async verificarAssercao(e: { audience: string }) {
    this.chamadas.push(`verificar:${e.audience}`);
    return { status: "VALID", assertionPublicId: "p", identityPublicId: PESSOA, issuerApplicationCode: "PCTEC_CENTRAL_SERVICOS" };
  }
}

let server: Server | undefined;
afterEach(() => server?.close());

async function subir(servico: FakeService, credencialCentral = CRED.central): Promise<string> {
  const app = createApp({
    validateSessionService: {
      execute: async () => ({ identityPublicId: PESSOA, sessionPublicId: "sessao" })
    } as unknown as ValidateSessionService,
    getPortalContextService: {} as unknown as GetPortalContextService,
    authorizeApplicationAccessService: {} as unknown as AuthorizeApplicationAccessService,
    requireOrganizationAccessService: {} as unknown as RequireOrganizationAccessService,
    getActiveOrganizationExternalReferenceService: {} as unknown as GetActiveOrganizationExternalReferenceService,
    serviceCredential: CRED.portal,
    helpdeskServiceCredential: CRED.helpdesk,
    meuRhServiceCredential: CRED.meuRh,
    centralServicosServiceCredential: credencialCentral,
    centralServicosService: servico as unknown as CentralServicosService
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once("listening", r));
  const a = server.address();
  if (a === null || typeof a === "string") throw new Error("endereço inesperado");
  return `http://127.0.0.1:${a.port}`;
}

const com = (header: string, valor: string, corpo?: unknown): RequestInit => ({
  method: corpo === undefined ? "GET" : "POST",
  headers: { [header]: valor, "content-type": "application/json" },
  ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) })
});

describe("namespace da Central de Serviços", () => {
  it("abre só com a credencial e o header da Central", async () => {
    const s = new FakeService();
    const base = await subir(s);
    const url = `${base}/api/v1/service/central-servicos/identities/${PESSOA}/authorization`;

    expect((await fetch(url, com(CENTRAL_SERVICOS_SERVICE_CREDENTIAL_HEADER_NAME, CRED.central))).status).toBe(200);
    // Header certo com segredo de outro produto, ou header de outro produto: 401.
    expect((await fetch(url, com(CENTRAL_SERVICOS_SERVICE_CREDENTIAL_HEADER_NAME, CRED.meuRh))).status).toBe(401);
    expect((await fetch(url, com(MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME, CRED.meuRh))).status).toBe(401);
    expect((await fetch(url, com(SERVICE_CREDENTIAL_HEADER_NAME, CRED.portal))).status).toBe(401);
    expect((await fetch(url, com(HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME, CRED.helpdesk))).status).toBe(401);
    // Cookie de sessão de navegador não abre nada aqui.
    expect((await fetch(url, { headers: { cookie: `${SESSION_COOKIE_NAME}=qualquer` } })).status).toBe(401);
    expect(s.chamadas).toEqual([`autorizacao:${PESSOA}`]);
  });

  it("credencial vazia mantém o namespace fechado", async () => {
    const base = await subir(new FakeService(), "");
    const r = await fetch(`${base}/api/v1/service/central-servicos/identities/${PESSOA}/authorization`, com(CENTRAL_SERVICOS_SERVICE_CREDENTIAL_HEADER_NAME, ""));
    expect(r.status).toBe(401);
  });

  it("autorização responde sem cache; emissão devolve 201 e erro de autorização vira 403", async () => {
    const base = await subir(new FakeService());
    const auth = await fetch(`${base}/api/v1/service/central-servicos/identities/${PESSOA}/authorization`, com(CENTRAL_SERVICOS_SERVICE_CREDENTIAL_HEADER_NAME, CRED.central));
    expect(auth.headers.get("cache-control")).toBe("no-store");
    expect(await auth.json()).toMatchObject({ accessProfile: "USER", roles: ["N1_OPERADOR"] });

    const ok = await fetch(`${base}/api/v1/service/central-servicos/delegation-assertions`, com(CENTRAL_SERVICOS_SERVICE_CREDENTIAL_HEADER_NAME, CRED.central, { identityPublicId: PESSOA }));
    expect(ok.status).toBe(201);
    const negado = await fetch(
      `${base}/api/v1/service/central-servicos/delegation-assertions`,
      com(CENTRAL_SERVICOS_SERVICE_CREDENTIAL_HEADER_NAME, CRED.central, { identityPublicId: "33333333-3333-4333-8333-000000000001" })
    );
    expect(negado.status).toBe(403);
    expect(await negado.text()).toContain("CENTRAL_SERVICOS_IDENTITY_NOT_AUTHORIZED");
  });

  it("a verificação é do Helpdesk: a Central não verifica, o Helpdesk não emite", async () => {
    const s = new FakeService();
    const base = await subir(s);
    const verify = `${base}/api/v1/service/helpdesk/delegation-assertions/verify`;
    expect((await fetch(verify, com(CENTRAL_SERVICOS_SERVICE_CREDENTIAL_HEADER_NAME, CRED.central, {}))).status).toBe(401);
    const r = await fetch(verify, com(HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME, CRED.helpdesk, { assertion: "x" }));
    expect(r.status).toBe(200);
    // Audiência fixada pela rota, nunca lida do corpo.
    expect(s.chamadas).toEqual(["verificar:PCTEC_HELPDESK"]);

    const emitir = `${base}/api/v1/service/central-servicos/delegation-assertions`;
    expect((await fetch(emitir, com(HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME, CRED.helpdesk, {}))).status).toBe(401);
  });
});

describe("SSO da Central de Serviços", () => {
  it("cliente só é registrado com redirect_uri configurada, e exige USER", () => {
    const base = {
      portalRedirectUris: [],
      portalLaunchUrl: "",
      portalIssuancePolicies: [],
      meuRhRedirectUris: [],
      meuRhLaunchUrl: "",
      meuRhIssuancePolicies: []
    };
    const sem = composeSso(base);
    expect(() => sem.registry.requireClientWithRedirectUri("PCTEC_CENTRAL_SERVICOS", "http://127.0.0.1:3013/api/auth/retorno")).toThrow();

    const com = composeSso({ ...base, centralServicosRedirectUris: ["http://127.0.0.1:3013/api/auth/retorno"], centralServicosLaunchUrl: "/x" });
    expect(() => com.registry.requireClientWithRedirectUri("PCTEC_CENTRAL_SERVICOS", "http://127.0.0.1:3013/api/auth/retorno")).not.toThrow();
    expect(() => com.registry.requireClientWithRedirectUri("PCTEC_CENTRAL_SERVICOS", "http://127.0.0.1:3013/api/auth/retorno/")).toThrow();
    expect(com.requiredProfileByClientId["PCTEC_CENTRAL_SERVICOS"]).toBe("USER");
    expect(com.issuancePolicyRegistry.isDeclaredFor("PCTEC_CENTRAL_SERVICOS")).toBe(true);
  });

  it("a credencial da Central só troca código emitido para a Central", () => {
    expect(APPLICATION_CODE_POR_CONSUMIDOR["PCTEC_CENTRAL_SERVICOS"]).toBe("PCTEC_CENTRAL_SERVICOS");
    const consumidores = buildSsoTokenServiceConsumers({ portal: "a", meuRh: "b", centralServicos: "c" });
    expect(consumidores.find((c) => c.consumerCode === "PCTEC_CENTRAL_SERVICOS")).toEqual({
      consumerCode: "PCTEC_CENTRAL_SERVICOS",
      headerName: CENTRAL_SERVICOS_SERVICE_CREDENTIAL_HEADER_NAME,
      credential: "c"
    });
  });
});
