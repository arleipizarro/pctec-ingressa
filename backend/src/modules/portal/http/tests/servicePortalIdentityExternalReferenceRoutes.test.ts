import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import type { ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { GetPortalContextService } from "../../application/GetPortalContextService.js";
import type { AuthorizeApplicationAccessService } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../../application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import type { GetActiveIdentityExternalReferenceService } from "../../../identity/application/GetActiveIdentityExternalReferenceService.js";
import { IdentityExternalReference } from "../../../identity/domain/IdentityExternalReference.js";
import { IdentityExternalReferenceNotFoundError } from "../../../identity/domain/errors/IdentityExternalReferenceErrors.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../requireServiceCredential.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ACTOR_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000099";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";
const REAL_SERVICE_CREDENTIAL = "segredo-de-teste-p1b0-fatia4";

interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly correlation_id: string | null;
  readonly details: readonly unknown[];
}

function extractError(body: Record<string, unknown>): ErrorEnvelope {
  return body["error"] as ErrorEnvelope;
}

class FakeGetActiveIdentityExternalReferenceService {
  public calls: Array<{ systemCode: string; entityType: string; legacyId: string | number }> = [];
  public shouldFind = true;
  public identityPublicId = IDENTITY_PUBLIC_ID;

  public async execute(
    systemCode: string,
    entityType: string,
    legacyId: string | number
  ): Promise<IdentityExternalReference> {
    this.calls.push({ systemCode, entityType, legacyId });
    if (!this.shouldFind) {
      throw new IdentityExternalReferenceNotFoundError(
        String(systemCode),
        String(entityType),
        String(legacyId)
      );
    }
    return IdentityExternalReference.create({
      identityPublicId: this.identityPublicId,
      systemCode,
      entityType: String(entityType),
      legacyId,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
  }
}

async function startTestServer(
  getActiveIdentityExternalReferenceService: FakeGetActiveIdentityExternalReferenceService,
  serviceCredential: string = REAL_SERVICE_CREDENTIAL
) {
  const app = createApp({
    // Serviços não exercitados por esta rota — fakes vazios mínimos.
    validateSessionService: {
      execute: async () => ({ identityPublicId: "", sessionPublicId: "" })
    } as unknown as ValidateSessionService,
    getPortalContextService: {} as unknown as GetPortalContextService,
    authorizeApplicationAccessService: {} as unknown as AuthorizeApplicationAccessService,
    requireOrganizationAccessService: {} as unknown as RequireOrganizationAccessService,
    getActiveOrganizationExternalReferenceService:
      {} as unknown as GetActiveOrganizationExternalReferenceService,
    getActiveIdentityExternalReferenceService:
      getActiveIdentityExternalReferenceService as unknown as GetActiveIdentityExternalReferenceService,
    serviceCredential
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("GET /api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId", () => {
  let server: Server;
  let baseUrl: string;
  let getActiveIdentityExternalReferenceService: FakeGetActiveIdentityExternalReferenceService;

  beforeEach(async () => {
    getActiveIdentityExternalReferenceService = new FakeGetActiveIdentityExternalReferenceService();
    ({ server, baseUrl } = await startTestServer(getActiveIdentityExternalReferenceService));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function url(legacyId: string | number): string {
    return `${baseUrl}/api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/${legacyId}`;
  }

  // A. sem credencial → 401
  it("A. sem credencial → 401 SERVICE_CREDENTIAL_INVALID, nunca chega ao service", async () => {
    const res = await fetch(url(33));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    expect(getActiveIdentityExternalReferenceService.calls).toHaveLength(0);
  });

  // B. credencial inválida → 401
  it("B. credencial inválida → 401 SERVICE_CREDENTIAL_INVALID — indistinguível de ausente", async () => {
    const res = await fetch(url(33), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: "credencial-errada" }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
    expect(getActiveIdentityExternalReferenceService.calls).toHaveLength(0);
  });

  // C. credencial válida + referência inexistente → 404
  it("C. credencial válida + referência ACTIVE inexistente → 404 IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND", async () => {
    getActiveIdentityExternalReferenceService.shouldFind = false;

    const res = await fetch(url(33), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(extractError(body).code).toBe("IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND");
  });

  // D. credencial válida + referência ACTIVE → 200
  it("D. credencial válida + referência ACTIVE → 200", async () => {
    const res = await fetch(url(33), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });

    expect(res.status).toBe(200);
  });

  // E. payload 200 contém somente identityPublicId
  it("E. payload 200 contém somente identityPublicId — sem nenhum campo extra", async () => {
    const res = await fetch(url(33), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ identityPublicId: IDENTITY_PUBLIC_ID });
    // Nenhum campo além de identityPublicId
    expect(Object.keys(body)).toEqual(["identityPublicId"]);
  });

  // F. não retorna legacyId
  it("F. não retorna legacyId no payload", async () => {
    const res = await fetch(url(33), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const rawBody = await res.text();

    expect(rawBody.toLowerCase()).not.toContain("legacyid");
    expect(rawBody).not.toContain("\"33\"");
    expect(rawBody).not.toContain(":33");
  });

  // G. não retorna matchMethod
  it("G. não retorna matchMethod no payload", async () => {
    const res = await fetch(url(33), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const rawBody = await res.text();

    expect(rawBody.toLowerCase()).not.toContain("matchmethod");
    expect(rawBody).not.toContain("MATCHED_MANUAL_CONFIRMED");
    expect(rawBody).not.toContain("MATCHED_BY_EMAIL");
  });

  // H. não retorna PII
  it("H. não retorna PII (email, nome, CPF, senha, credential, status interno, publicId da referência)", async () => {
    const res = await fetch(url(33), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const rawBody = await res.text().then((t) => t.toLowerCase());

    for (const forbidden of ["email", "cpf", "senha", "password", "credential", "status", "legacyid"]) {
      expect(rawBody, `não deve conter: ${forbidden}`).not.toContain(forbidden);
    }
    // publicId da própria referência ≠ identityPublicId: verificar que
    // só o identityPublicId esperado aparece, não um segundo UUID.
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    expect(Object.keys(parsed)).toHaveLength(1);
    expect(parsed["identitypublicid"]).toBe(IDENTITY_PUBLIC_ID.toLowerCase());
  });

  // I. legacyId inválido → erro de domínio (VO LegacyId, nunca validação duplicada na rota)
  it("I. legacyId inválido ('abc') → 422 LEGACY_ID_INVALID — validação feita pelo VO, nunca pela rota", async () => {
    const res = await fetch(url("abc"), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(422);
    expect(extractError(body).code).toBe("LEGACY_ID_INVALID");
  });

  it("I. legacyId=0 → 422 LEGACY_ID_INVALID", async () => {
    const res = await fetch(url(0), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(422);
    expect(extractError(body).code).toBe("LEGACY_ID_INVALID");
  });

  // J. prova que a rota usa GetActiveIdentityExternalReferenceService
  it("J. GetActiveIdentityExternalReferenceService é chamado com PCTEC_PORTAL, portal_acesso, legacyId do path", async () => {
    await fetch(url(33), {
      headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: REAL_SERVICE_CREDENTIAL }
    });

    expect(getActiveIdentityExternalReferenceService.calls).toHaveLength(1);
    expect(getActiveIdentityExternalReferenceService.calls[0]).toEqual({
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: "33"
    });
  });

  // K. prova estrutural: sem SQL bruto
  it("K. sem SQL bruto no arquivo de rota — todo acesso a dados via GetActiveIdentityExternalReferenceService", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const sourcePath = fileURLToPath(
      new URL("../servicePortalIdentityExternalReferenceRoutes.ts", import.meta.url)
    );
    const sourceUpper = readFileSync(sourcePath, "utf-8").toUpperCase();
    expect(sourceUpper).not.toContain("INSERT INTO");
    expect(sourceUpper).not.toContain("SELECT ");
    expect(sourceUpper).not.toContain("DELETE FROM");
  });
});

// L. rotas browser-facing existentes continuam intactas
describe("L. rotas browser-facing existentes não são afetadas pela nova rota service-to-service", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const svc = new FakeGetActiveIdentityExternalReferenceService();
    ({ server, baseUrl } = await startTestServer(svc));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /health continua respondendo 200 mesmo com a nova rota wired", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body["status"]).toBe("ok");
  });

  it("nova rota não vaza para o namespace browser-facing /api/v1/portal/...", async () => {
    // Sem credencial de serviço, sem sessão — deve cair no
    // requireAuthenticatedSession do /api/v1/portal (401 SESSION_INVALID),
    // nunca na lógica de credencial de serviço.
    const res = await fetch(
      `${baseUrl}/api/v1/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/33`
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(401);
    // Deve ser SESSION_INVALID (browser-facing), nunca SERVICE_CREDENTIAL_INVALID
    expect(extractError(body).code).toBe("SESSION_INVALID");
    expect(extractError(body).code).not.toBe("SERVICE_CREDENTIAL_INVALID");
  });
});

// M. P1A.1 existente continua funcionando sem alteração
describe("M. rota P1A.1 existente continua intacta após adição da Fatia 4", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const svc = new FakeGetActiveIdentityExternalReferenceService();
    ({ server, baseUrl } = await startTestServer(svc));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("P1A.1: sem credencial na rota de organização → 401 SERVICE_CREDENTIAL_INVALID (rota P1A.1 ainda protegida)", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/service/portal/identities/66231e51-66fb-466d-af4f-ac7b925ca9ec/organizations/971ec096-e7de-4cc1-be06-2b4709565757/external-references/PCTEC_PORTAL`
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(401);
    expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");
  });
});

// Prova de fail-closed: credential vazia = rota indisponível (fail-closed DA ROTA, nunca fail-stop)
describe("fail-closed da rota com serviceCredential vazio — comportamento inalterado da Fatia 4", () => {
  it("com serviceCredential='', nova rota retorna 401 (fail-closed) e /health continua 200", async () => {
    const svc = new FakeGetActiveIdentityExternalReferenceService();
    const { server, baseUrl } = await startTestServer(svc, "");

    try {
      const routeRes = await fetch(
        `${baseUrl}/api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/33`,
        { headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: "qualquer-coisa" } }
      );
      const body = (await routeRes.json()) as Record<string, unknown>;
      expect(routeRes.status).toBe(401);
      expect(extractError(body).code).toBe("SERVICE_CREDENTIAL_INVALID");

      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
