import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../../../app/http/createApp.js";
import type { ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { GetHelpdeskUserContextService } from "../../application/GetHelpdeskUserContextService.js";
import {
  HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME,
  SERVICE_CREDENTIAL_HEADER_NAME
} from "../../../portal/http/requireServiceCredential.js";
import {
  HelpdeskContextInconsistentError,
  HelpdeskIdentityNotActiveError,
  HelpdeskReferenceAmbiguousError
} from "../../domain/errors/HelpdeskErrors.js";
import { IdentityExternalReferenceNotFoundError } from "../../../identity/domain/errors/IdentityExternalReferenceErrors.js";
import { ApplicationAccessDeniedError } from "../../../authorization/domain/errors/AuthorizationErrors.js";

const CREDENCIAL_HELPDESK = "credencial-de-teste-do-helpdesk";
const CREDENCIAL_PORTAL = "credencial-de-teste-do-portal";
const BOSQUE = {
  publicId: "971ec096-e7de-4cc1-be06-2b4709565757",
  type: "COMPANY",
  legalName: "EMPRESA SINTETICA - BOSQUE",
  tradeName: "SINTETICA - BOSQUE"
};

let servidor: Server | undefined;

async function subir(execute: () => Promise<{ organizations: readonly unknown[] }>) {
  const app = createApp({
    validateSessionService: { execute: async () => ({ identityPublicId: "", sessionPublicId: "" }) } as unknown as ValidateSessionService,
    getHelpdeskUserContextService: { execute } as unknown as GetHelpdeskUserContextService,
    serviceCredential: CREDENCIAL_PORTAL,
    helpdeskServiceCredential: CREDENCIAL_HELPDESK
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  servidor = server;
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

const contextoOk = async () => ({ organizations: [BOSQUE] });

async function chamar(baseUrl: string, legacyUserId: string, headers: Record<string, string> = {}) {
  const resposta = await fetch(`${baseUrl}/api/v1/service/helpdesk/users/${legacyUserId}/context`, { headers });
  return { status: resposta.status, body: (await resposta.json()) as Record<string, unknown> };
}

afterEach(async () => {
  if (servidor !== undefined) {
    await new Promise<void>((resolve) => servidor!.close(() => resolve()));
    servidor = undefined;
  }
});

describe("GET /api/v1/service/helpdesk/users/:legacyUserId/context — credencial", () => {
  it("401 sem credencial", async () => {
    const baseUrl = await subir(contextoOk);
    const { status } = await chamar(baseUrl, "35");
    expect(status).toBe(401);
  });

  it("401 com credencial errada", async () => {
    const baseUrl = await subir(contextoOk);
    const { status } = await chamar(baseUrl, "35", { [HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME]: "errada" });
    expect(status).toBe(401);
  });

  it("401 com a credencial do PORTAL — credenciais não são intercambiáveis", async () => {
    const baseUrl = await subir(contextoOk);
    const { status } = await chamar(baseUrl, "35", { [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_PORTAL });
    expect(status).toBe(401);
  });

  it("401 quando a credencial do Helpdesk vem no header do Portal", async () => {
    const baseUrl = await subir(contextoOk);
    const { status } = await chamar(baseUrl, "35", { [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_HELPDESK });
    expect(status).toBe(401);
  });
});

describe("GET /api/v1/service/helpdesk/users/:legacyUserId/context — respostas", () => {
  const comCredencial = { [HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_HELPDESK };

  it("200 com as organizações autorizadas e nada além disso", async () => {
    const baseUrl = await subir(contextoOk);
    const { status, body } = await chamar(baseUrl, "35", comCredencial);

    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["organizations"]);
    const orgs = body["organizations"] as Record<string, unknown>[];
    expect(orgs).toHaveLength(1);
    expect(Object.keys(orgs[0]!).sort()).toEqual(["legalName", "publicId", "tradeName", "type"]);
  });

  it("o payload não carrega identidade, membership, perfil, escopo ou legado", async () => {
    const baseUrl = await subir(contextoOk);
    const { body } = await chamar(baseUrl, "35", comCredencial);
    const serializado = JSON.stringify(body).toLowerCase();

    for (const proibido of [
      "identitypublicid", "membership", "profile", "scope", "legacy", "client_id",
      "email", "cpf", "password", "senha", "hash", "token", "credential"
    ]) {
      expect(serializado).not.toContain(proibido);
    }
  });

  it("404 quando não há referência — usuário ainda não gerenciado pelo Ingressa", async () => {
    const baseUrl = await subir(async () => {
      throw new IdentityExternalReferenceNotFoundError("PCTEC_HELPDESK", "users", "45");
    });
    const { status, body } = await chamar(baseUrl, "45", comCredencial);

    expect(status).toBe(404);
    expect((body["error"] as { code: string }).code).toBe("IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND");
  });

  it("403 quando o acesso foi revogado", async () => {
    const baseUrl = await subir(async () => {
      throw new ApplicationAccessDeniedError("ACCESS_NOT_GRANTED");
    });
    expect((await chamar(baseUrl, "35", comCredencial)).status).toBe(403);
  });

  it("403 quando a identidade não está ACTIVE", async () => {
    const baseUrl = await subir(async () => {
      throw new HelpdeskIdentityNotActiveError("INACTIVE");
    });
    expect((await chamar(baseUrl, "35", comCredencial)).status).toBe(403);
  });

  it("403 — nunca 200 com lista vazia", async () => {
    const baseUrl = await subir(async () => ({ organizations: [] }));
    const { status, body } = await chamar(baseUrl, "35", comCredencial);

    expect(status).toBe(403);
    expect((body["error"] as { code: string }).code).toBe("HELPDESK_CONTEXT_EMPTY");
  });

  it.each([
    ["referência ambígua", new HelpdeskReferenceAmbiguousError(2)],
    ["cadastro inconsistente", new HelpdeskContextInconsistentError("identidade inexistente")]
  ])("409 quando há %s", async (_caso, erro) => {
    const baseUrl = await subir(async () => {
      throw erro;
    });
    expect((await chamar(baseUrl, "35", comCredencial)).status).toBe(409);
  });

  it("422 quando o legacyUserId é malformado", async () => {
    const baseUrl = await subir(async () => {
      const { InvalidLegacyIdError } = await import("../../../identity/domain/value-objects/LegacyId.js");
      throw new InvalidLegacyIdError();
    });
    expect((await chamar(baseUrl, "abc", comCredencial)).status).toBe(422);
  });
});
