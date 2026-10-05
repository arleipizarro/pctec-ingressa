import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../../../app/http/createApp.js";
import type { ValidateSessionService } from "../../../security/application/ValidateSessionService.js";
import type { GetPortalContextService } from "../../application/GetPortalContextService.js";
import type { AuthorizeApplicationAccessService, AuthorizedApplicationAccess } from "../../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../../application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import type { GetActiveIdentityExternalReferenceService } from "../../../identity/application/GetActiveIdentityExternalReferenceService.js";
import type { ApplicationRoleService } from "../../../applicationrole/application/ApplicationRoleService.js";
import { ApplicationAccessDeniedError } from "../../../authorization/domain/errors/AuthorizationErrors.js";
import { SERVICE_CREDENTIAL_HEADER_NAME } from "../requireServiceCredential.js";

const IDENTITY = "b7a0c1d2-0000-4000-8000-000000000001";
const CREDENCIAL = "segredo-de-teste-portal-roles";

class FakeAuthorize {
  public calls: Array<{ identityPublicId: string; applicationCode: string; requiredProfile: string }> = [];
  public concede = true;

  public async execute(request: {
    identityPublicId: string;
    applicationCode: string;
    requiredProfile: string;
  }): Promise<AuthorizedApplicationAccess> {
    this.calls.push(request);
    if (!this.concede) {
      throw new ApplicationAccessDeniedError("ACCESS_NOT_FOUND");
    }
    return {
      identityPublicId: request.identityPublicId,
      applicationPublicId: "3f9c1a2e-7d4b-4e5a-9c3f-000000000001",
      applicationCode: request.applicationCode,
      accessProfile: request.requiredProfile
    };
  }
}

class FakeRoles {
  public calls: Array<{ identityPublicId: string; applicationCode: string }> = [];
  public roles: readonly string[] = ["PORTAL_ADMIN_GLOBAL"];

  public async perfisConcedidos(identityPublicId: string, applicationCode: string): Promise<readonly string[]> {
    this.calls.push({ identityPublicId, applicationCode });
    return this.roles;
  }
}

async function iniciar(authorize: FakeAuthorize, roles: FakeRoles) {
  const app = createApp({
    validateSessionService: {
      execute: async () => ({ identityPublicId: "", sessionPublicId: "" })
    } as unknown as ValidateSessionService,
    requireOrganizationAccessService: {} as unknown as RequireOrganizationAccessService,
    getActiveOrganizationExternalReferenceService: {} as unknown as GetActiveOrganizationExternalReferenceService,
    getActiveIdentityExternalReferenceService: {} as unknown as GetActiveIdentityExternalReferenceService,
    authorizeApplicationAccessService: authorize as unknown as AuthorizeApplicationAccessService,
    getPortalContextService: {} as unknown as GetPortalContextService,
    applicationRoleService: roles as unknown as ApplicationRoleService,
    serviceCredential: CREDENCIAL
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${address.port}/api/v1/service/portal/identities/${IDENTITY}/application-roles` };
}

describe("GET /api/v1/service/portal/identities/:identityPublicId/application-roles", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("devolve os perfis do Portal depois de conferir a camada 1 (PCTEC_PORTAL, USER)", async () => {
    const authorize = new FakeAuthorize();
    const roles = new FakeRoles();
    const iniciado = await iniciar(authorize, roles);
    server = iniciado.server;

    const res = await fetch(iniciado.url, { headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roles: ["PORTAL_ADMIN_GLOBAL"] });
    expect(authorize.calls).toEqual([
      { identityPublicId: IDENTITY, applicationCode: "PCTEC_PORTAL", requiredProfile: "USER" }
    ]);
    // O catálogo consultado é o do PORTAL — nunca o de outra aplicação,
    // onde um "admin" significaria outra coisa.
    expect(roles.calls).toEqual([{ identityPublicId: IDENTITY, applicationCode: "PCTEC_PORTAL" }]);
  });

  it("sem perfil concedido devolve lista vazia, não erro", async () => {
    const roles = new FakeRoles();
    roles.roles = [];
    const iniciado = await iniciar(new FakeAuthorize(), roles);
    server = iniciado.server;

    const res = await fetch(iniciado.url, { headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roles: [] });
  });

  it("sem acesso ao Portal responde 403 e NUNCA consulta perfis", async () => {
    const authorize = new FakeAuthorize();
    authorize.concede = false;
    const roles = new FakeRoles();
    const iniciado = await iniciar(authorize, roles);
    server = iniciado.server;

    const res = await fetch(iniciado.url, { headers: { [SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL } });

    expect(res.status).toBe(403);
    const corpo = (await res.json()) as { error: { code: string } };
    expect(corpo.error.code).toBe("APPLICATION_ACCESS_DENIED");
    expect(roles.calls).toEqual([]);
  });

  it("sem a credencial de serviço responde 401 e não chega ao handler", async () => {
    const authorize = new FakeAuthorize();
    const roles = new FakeRoles();
    const iniciado = await iniciar(authorize, roles);
    server = iniciado.server;

    const res = await fetch(iniciado.url);

    expect(res.status).toBe(401);
    expect(authorize.calls).toEqual([]);
    expect(roles.calls).toEqual([]);
  });
});
