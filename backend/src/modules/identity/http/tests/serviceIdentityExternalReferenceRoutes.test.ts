/**
 * `GET /api/v1/service/identity-external-references/:systemCode/:entityType/identities/:identityPublicId`
 *
 * Fronteira service-to-service genérica da fundação PCTEC Meu RH.
 * Prova aqui: credencial PRÓPRIA obrigatória, isolamento das credenciais
 * já existentes, ausência de caminho para o navegador, e payload mínimo.
 */
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import type { ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { GetPortalContextService } from "../../../portal/application/GetPortalContextService.js";
import type { AuthorizeApplicationAccessService } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../../../portal/application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import type { GetActiveIdentityExternalReferenceByIdentityService } from "../../application/GetActiveIdentityExternalReferenceByIdentityService.js";
import { IdentityExternalReference } from "../../domain/IdentityExternalReference.js";
import {
  IdentityExternalReferenceBindingAmbiguousError,
  IdentityExternalReferenceBindingNotFoundError
} from "../../domain/errors/IdentityExternalReferenceErrors.js";
import {
  IDENTITY_RESOLUTION_SERVICE_CREDENTIAL_HEADER_NAME,
  SERVICE_CREDENTIAL_HEADER_NAME,
  HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME
} from "../../../portal/http/requireServiceCredential.js";
import { SESSION_COOKIE_NAME } from "../../../security/http/sessionCookie.js";

const IDENTIDADE = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ATOR = "0b13f6f0-8f3a-4a1e-9c2d-000000000099";
const CORRELACAO = "8f14e45f-ceea-467e-a1a3-000000000001";
const CREDENCIAL_RESOLUCAO = "segredo-de-teste-resolucao-de-binding";
const CREDENCIAL_PORTAL = "segredo-de-teste-portal";
const CREDENCIAL_HELPDESK = "segredo-de-teste-helpdesk";
const LEGACY_ID = 999801;

const CAMINHO = `/api/v1/service/identity-external-references/PCTEC_HUB/rh_colaboradores/identities/${IDENTIDADE}`;

type Falha = "NENHUMA" | "SEM_VINCULO" | "AMBIGUO";

class FakeResolucao {
  public chamadas: Array<{ identityPublicId: string; systemCode: string; entityType: string }> = [];
  public falha: Falha = "NENHUMA";

  public async execute(
    identityPublicId: string,
    systemCode: string,
    entityType: string
  ): Promise<IdentityExternalReference> {
    this.chamadas.push({ identityPublicId, systemCode, entityType });
    if (this.falha === "SEM_VINCULO") {
      throw new IdentityExternalReferenceBindingNotFoundError(identityPublicId, systemCode, entityType);
    }
    if (this.falha === "AMBIGUO") {
      throw new IdentityExternalReferenceBindingAmbiguousError(identityPublicId, systemCode, entityType);
    }
    return IdentityExternalReference.create({
      identityPublicId,
      systemCode,
      entityType,
      legacyId: LEGACY_ID,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ATOR,
      correlationId: CORRELACAO
    });
  }
}

async function subirServidor(resolucao: FakeResolucao, credencialResolucao = CREDENCIAL_RESOLUCAO) {
  const app = createApp({
    validateSessionService: {
      execute: async () => ({ identityPublicId: IDENTIDADE, sessionPublicId: "sessao" })
    } as unknown as ValidateSessionService,
    getPortalContextService: {} as unknown as GetPortalContextService,
    authorizeApplicationAccessService: {} as unknown as AuthorizeApplicationAccessService,
    requireOrganizationAccessService: {} as unknown as RequireOrganizationAccessService,
    getActiveOrganizationExternalReferenceService: {} as unknown as GetActiveOrganizationExternalReferenceService,
    getActiveIdentityExternalReferenceByIdentityService:
      resolucao as unknown as GetActiveIdentityExternalReferenceByIdentityService,
    serviceCredential: CREDENCIAL_PORTAL,
    helpdeskServiceCredential: CREDENCIAL_HELPDESK,
    identityResolutionServiceCredential: credencialResolucao
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("resolução service-to-service de binding — proteção da fronteira", () => {
  let server: Server;
  let baseUrl: string;
  let resolucao: FakeResolucao;

  beforeEach(async () => {
    resolucao = new FakeResolucao();
    ({ server, baseUrl } = await subirServidor(resolucao));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("sem nenhuma credencial: 401 e o caso de uso NUNCA é alcançado", async () => {
    const res = await fetch(`${baseUrl}${CAMINHO}`);

    expect(res.status).toBe(401);
    expect(resolucao.chamadas).toHaveLength(0);
  });

  it("com credencial errada no header certo: 401", async () => {
    const res = await fetch(`${baseUrl}${CAMINHO}`, {
      headers: { [IDENTITY_RESOLUTION_SERVICE_CREDENTIAL_HEADER_NAME]: "credencial-errada" }
    });

    expect(res.status).toBe(401);
    expect(resolucao.chamadas).toHaveLength(0);
  });

  it("a credencial do PORTAL não abre este namespace", async () => {
    const res = await fetch(`${baseUrl}${CAMINHO}`, {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_PORTAL }
    });

    expect(res.status).toBe(401);
    expect(resolucao.chamadas).toHaveLength(0);
  });

  it("a credencial do HELPDESK não abre este namespace", async () => {
    const res = await fetch(`${baseUrl}${CAMINHO}`, {
      headers: { [HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_HELPDESK }
    });

    expect(res.status).toBe(401);
    expect(resolucao.chamadas).toHaveLength(0);
  });

  it("o valor certo no header do PORTAL também não serve — o header é parte do isolamento", async () => {
    const res = await fetch(`${baseUrl}${CAMINHO}`, {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_RESOLUCAO }
    });

    expect(res.status).toBe(401);
  });

  it("NAVEGADOR não ganha acesso: cookie de sessão válido não substitui a credencial de máquina", async () => {
    const res = await fetch(`${baseUrl}${CAMINHO}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=token-de-sessao-valido` }
    });

    expect(res.status).toBe(401);
    expect(resolucao.chamadas).toHaveLength(0);
  });

  it("nenhuma rota browser-facing expõe a mesma resolução", async () => {
    const alternativas = [
      `/api/v1/identity-external-references/PCTEC_HUB/rh_colaboradores/identities/${IDENTIDADE}`,
      `/api/v1/portal/identity-external-references/PCTEC_HUB/rh_colaboradores/identities/${IDENTIDADE}`
    ];

    for (const caminho of alternativas) {
      const res = await fetch(`${baseUrl}${caminho}`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=token-de-sessao-valido` }
      });
      expect(res.status).not.toBe(200);
    }
    expect(resolucao.chamadas).toHaveLength(0);
  });
});

describe("resolução service-to-service de binding — namespace sem credencial configurada", () => {
  it("credencial vazia deixa o namespace INDISPONÍVEL (401), nunca aberto", async () => {
    const resolucao = new FakeResolucao();
    const { server, baseUrl } = await subirServidor(resolucao, "");
    try {
      const semHeader = await fetch(`${baseUrl}${CAMINHO}`);
      const comHeaderVazio = await fetch(`${baseUrl}${CAMINHO}`, {
        headers: { [IDENTITY_RESOLUTION_SERVICE_CREDENTIAL_HEADER_NAME]: "" }
      });

      expect(semHeader.status).toBe(401);
      expect(comHeaderVazio.status).toBe(401);
      expect(resolucao.chamadas).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe("resolução service-to-service de binding — respostas", () => {
  let server: Server;
  let baseUrl: string;
  let resolucao: FakeResolucao;

  const comCredencial = { [IDENTITY_RESOLUTION_SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL_RESOLUCAO };

  beforeEach(async () => {
    resolucao = new FakeResolucao();
    ({ server, baseUrl } = await subirServidor(resolucao));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("200 com o payload mínimo — e NADA além dele", async () => {
    const res = await fetch(`${baseUrl}${CAMINHO}`, { headers: comCredencial });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({
      identityPublicId: IDENTIDADE,
      systemCode: "PCTEC_HUB",
      entityType: "rh_colaboradores",
      legacyId: LEGACY_ID
    });
    expect(Object.keys(body).sort()).toEqual(["entityType", "identityPublicId", "legacyId", "systemCode"]);
  });

  it("os três segmentos da URI chegam ao caso de uso exatamente como vieram", async () => {
    await fetch(`${baseUrl}${CAMINHO}`, { headers: comCredencial });

    expect(resolucao.chamadas).toEqual([
      { identityPublicId: IDENTIDADE, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores" }
    ]);
  });

  it("sem vínculo: 404 IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND", async () => {
    resolucao.falha = "SEM_VINCULO";

    const res = await fetch(`${baseUrl}${CAMINHO}`, { headers: comCredencial });
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND");
  });

  it("vínculo ambíguo: 409 IDENTITY_EXTERNAL_REFERENCE_AMBIGUOUS — recusa, nunca escolha", async () => {
    resolucao.falha = "AMBIGUO";

    const res = await fetch(`${baseUrl}${CAMINHO}`, { headers: comCredencial });
    const body = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("IDENTITY_EXTERNAL_REFERENCE_AMBIGUOUS");
  });
});
