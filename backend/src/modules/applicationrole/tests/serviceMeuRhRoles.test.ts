/**
 * Perfis de aplicação na fronteira do PCTEC Meu RH.
 *
 * O que estes testes provam:
 *   1. o consumidor recebe as DUAS camadas de ADR-007 numa resposta só,
 *      e a camada 2 nunca vem sem a camada 1;
 *   2. conceder e revogar passam pelo serviço — a rota não escreve nada
 *      por conta própria;
 *   3. um código de perfil malformado é recusado ANTES de chegar ao
 *      serviço;
 *   4. a credencial própria continua obrigatória, como no resto do
 *      namespace.
 */
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../../app/http/createApp.js";
import type { ApplicationRoleService } from "../application/ApplicationRoleService.js";
import type { MeuRhDirectoryService } from "../../meurh/application/MeuRhDirectoryService.js";
import type { ValidateSessionService } from "../../security/application/ValidateSessionService.js";
import type { GetPortalContextService } from "../../portal/application/GetPortalContextService.js";
import type { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../../portal/application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME } from "../../identity/http/identityResolutionServiceConsumers.js";

const CREDENCIAL = "segredo-de-teste-meu-rh";
const IDENTIDADE = "22222222-2222-4222-8222-000000000001";

/** Duplo que REGISTRA as chamadas — é o que distingue "rota delegou" de "rota inventou". */
class FakePerfis {
  public concedidos: Array<{ identityPublicId: string; roleCode: string; ator: string | undefined }> = [];
  public revogados: Array<{ identityPublicId: string; roleCode: string }> = [];
  public papeisDe = new Map<string, readonly string[]>();

  public async catalogo() {
    return [
      {
        publicId: "b1f0c3a2-5d47-4e88-9a12-000000000001",
        code: "MEURH_SUPER_ADMIN",
        name: "Super administrador do Meu RH",
        description: "Todas as permissões.",
        permissions: ["meurh.access"],
        status: "ACTIVE"
      }
    ];
  }

  public async concessoes() {
    return [
      {
        publicId: "38b1718b-7af2-430f-adf5-88478d8e2664",
        identityPublicId: IDENTIDADE,
        roleCode: "MEURH_SUPER_ADMIN",
        grantedAt: new Date("2026-09-19T23:00:00.000Z"),
        grantedByIdentityPublicId: null,
        grantedByFullName: null,
        grantedByLabel: "RECONCILIACAO",
        fullName: "Fulana de Teste",
        email: "fulana@exemplo.test"
      }
    ];
  }

  public async concessoesDaPessoa() {
    return [];
  }

  public async perfisConcedidos(identityPublicId: string) {
    return this.papeisDe.get(identityPublicId) ?? [];
  }

  public async conceder(entrada: { identityPublicId: string; roleCode: string; grantedByIdentityPublicId?: string }) {
    this.concedidos.push({
      identityPublicId: entrada.identityPublicId,
      roleCode: entrada.roleCode,
      ator: entrada.grantedByIdentityPublicId
    });
    return { assignmentPublicId: "nova", roleCode: entrada.roleCode, changed: true };
  }

  public async revogar(entrada: { identityPublicId: string; roleCode: string }) {
    this.revogados.push({ identityPublicId: entrada.identityPublicId, roleCode: entrada.roleCode });
    return { assignmentPublicId: "nova", roleCode: entrada.roleCode, changed: true };
  }
}

/** Diretório mínimo: só o que a rota de perfil de acesso consulta. */
class FakeDiretorio {
  public perfil: string | null = "USER";
  public async perfilDeAcesso() {
    return this.perfil;
  }
}

async function subirServidor(perfis: FakePerfis, diretorio: FakeDiretorio) {
  const app = createApp({
    validateSessionService: {
      execute: async () => ({ identityPublicId: IDENTIDADE, sessionPublicId: "sessao" })
    } as unknown as ValidateSessionService,
    getPortalContextService: {} as unknown as GetPortalContextService,
    authorizeApplicationAccessService: {} as unknown as AuthorizeApplicationAccessService,
    requireOrganizationAccessService: {} as unknown as RequireOrganizationAccessService,
    getActiveOrganizationExternalReferenceService: {} as unknown as GetActiveOrganizationExternalReferenceService,
    serviceCredential: "segredo-portal",
    helpdeskServiceCredential: "segredo-helpdesk",
    meuRhServiceCredential: CREDENCIAL,
    meuRhDirectoryService: diretorio as unknown as MeuRhDirectoryService,
    applicationRoleService: perfis as unknown as ApplicationRoleService
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

let servidorAtivo: Server | undefined;

afterEach(async () => {
  if (servidorAtivo !== undefined) {
    await new Promise<void>((resolve) => servidorAtivo?.close(() => resolve()));
    servidorAtivo = undefined;
  }
});

async function comServidor(perfis: FakePerfis, diretorio = new FakeDiretorio()) {
  const { server, baseUrl } = await subirServidor(perfis, diretorio);
  servidorAtivo = server;
  return baseUrl;
}

const cabecalhos = { [MEU_RH_SERVICE_CREDENTIAL_HEADER_NAME]: CREDENCIAL, "content-type": "application/json" };

describe("GET /identities/:id/access-profile", () => {
  it("devolve as duas camadas: perfil de acesso e papéis concedidos", async () => {
    const perfis = new FakePerfis();
    perfis.papeisDe.set(IDENTIDADE, ["MEURH_SUPER_ADMIN"]);
    const baseUrl = await comServidor(perfis);

    const resposta = await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/${IDENTIDADE}/access-profile`, {
      headers: cabecalhos
    });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ accessProfile: "USER", roles: ["MEURH_SUPER_ADMIN"] });
  });

  it("sem acesso à aplicação, a lista de papéis vem VAZIA — a camada 1 é pré-requisito da 2", async () => {
    const perfis = new FakePerfis();
    // Mesmo que houvesse papel concedido, ele não deve sair daqui: um
    // consumidor distraído poderia usá-lo sem conferir o acesso.
    perfis.papeisDe.set(IDENTIDADE, ["MEURH_SUPER_ADMIN"]);
    const diretorio = new FakeDiretorio();
    diretorio.perfil = null;
    const baseUrl = await comServidor(perfis, diretorio);

    const resposta = await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/${IDENTIDADE}/access-profile`, {
      headers: cabecalhos
    });

    expect(await resposta.json()).toEqual({ accessProfile: null, roles: [] });
  });

  it("sem a credencial própria, o namespace inteiro responde 401", async () => {
    const baseUrl = await comServidor(new FakePerfis());

    const resposta = await fetch(`${baseUrl}/api/v1/service/meu-rh/roles`);

    expect(resposta.status).toBe(401);
  });
});

describe("catálogo e concessões", () => {
  it("GET /roles devolve o catálogo da aplicação", async () => {
    const baseUrl = await comServidor(new FakePerfis());

    const corpo = (await (await fetch(`${baseUrl}/api/v1/service/meu-rh/roles`, { headers: cabecalhos })).json()) as {
      roles: { code: string }[];
    };

    expect(corpo.roles.map((papel) => papel.code)).toEqual(["MEURH_SUPER_ADMIN"]);
  });

  it("GET /roles/grants diz QUEM tem, quando recebeu e por quem", async () => {
    const baseUrl = await comServidor(new FakePerfis());

    const corpo = (await (
      await fetch(`${baseUrl}/api/v1/service/meu-rh/roles/grants`, { headers: cabecalhos })
    ).json()) as { grants: { roleCode: string; fullName: string; grantedBy: string | null }[] };

    expect(corpo.grants).toHaveLength(1);
    expect(corpo.grants[0]?.roleCode).toBe("MEURH_SUPER_ADMIN");
    expect(corpo.grants[0]?.fullName).toBe("Fulana de Teste");
    // Sem actor real, o rótulo diz o que de fato aconteceu em vez de
    // atribuir a concessão a uma pessoa que não apertou botão nenhum.
    expect(corpo.grants[0]?.grantedBy).toBe("RECONCILIACAO");
  });
});

describe("conceder e revogar", () => {
  it("a rota delega ao serviço, com o ator informado", async () => {
    const perfis = new FakePerfis();
    const baseUrl = await comServidor(perfis);

    const resposta = await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/${IDENTIDADE}/roles`, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({ roleCode: "MEURH_GESTOR", actorPublicId: "ator-1" })
    });

    expect(resposta.status).toBe(200);
    expect(perfis.concedidos).toEqual([
      { identityPublicId: IDENTIDADE, roleCode: "MEURH_GESTOR", ator: "ator-1" }
    ]);
  });

  it("sem ator, a concessão é atribuída a um rótulo de operação — nunca a um UUID inventado", async () => {
    const perfis = new FakePerfis();
    const baseUrl = await comServidor(perfis);

    await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/${IDENTIDADE}/roles`, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({ roleCode: "MEURH_GESTOR" })
    });

    expect(perfis.concedidos[0]?.ator).toBeUndefined();
  });

  it("revogar chega ao serviço com o perfil pedido", async () => {
    const perfis = new FakePerfis();
    const baseUrl = await comServidor(perfis);

    await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/${IDENTIDADE}/roles/revoke`, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({ roleCode: "MEURH_GESTOR", actorPublicId: "ator-1" })
    });

    expect(perfis.revogados).toEqual([{ identityPublicId: IDENTIDADE, roleCode: "MEURH_GESTOR" }]);
  });

  it("código de perfil malformado é recusado ANTES de o serviço ser chamado", async () => {
    const perfis = new FakePerfis();
    const baseUrl = await comServidor(perfis);

    for (const roleCode of ["", "minusculo", "COM ESPACO", "'; DROP TABLE x; --"]) {
      const resposta = await fetch(`${baseUrl}/api/v1/service/meu-rh/identities/${IDENTIDADE}/roles`, {
        method: "POST",
        headers: cabecalhos,
        body: JSON.stringify({ roleCode })
      });
      expect(resposta.status).toBeGreaterThanOrEqual(400);
    }
    expect(perfis.concedidos).toEqual([]);
  });
});
