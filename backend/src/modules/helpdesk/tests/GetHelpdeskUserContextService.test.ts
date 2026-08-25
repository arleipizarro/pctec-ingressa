import { describe, expect, it } from "vitest";
import { GetHelpdeskUserContextService } from "../application/GetHelpdeskUserContextService.js";
import {
  HelpdeskContextInconsistentError,
  HelpdeskIdentityNotActiveError,
  HelpdeskReferenceAmbiguousError
} from "../domain/errors/HelpdeskErrors.js";
import { IdentityExternalReferenceNotFoundError } from "../../identity/domain/errors/IdentityExternalReferenceErrors.js";
import { ApplicationAccessDeniedError } from "../../authorization/domain/errors/AuthorizationErrors.js";
import type { PortalContextResult } from "../../portal/application/GetPortalContextService.js";

const IDENTITY_PUBLIC_ID = "8aceafb7-5ff7-4043-947b-85f035757e9e";
const BOSQUE = {
  publicId: "971ec096-e7de-4cc1-be06-2b4709565757",
  type: "COMPANY",
  legalName: "EMPRESA SINTETICA - BOSQUE",
  tradeName: "SINTETICA - BOSQUE"
};
const CLIENT_ID_SINTETICO = 999975;
// UUIDs sintéticos — o VO `PublicId` valida a forma, então fixture com
// apelido ("grp-1") não passa nem no teste.
const GRUPO = { publicId: "11111111-1111-4111-8111-111111111111", type: "BUSINESS_GROUP", legalName: "GRUPO", tradeName: "GRUPO" };
const OUTRA = { publicId: "22222222-2222-4222-8222-222222222222", type: "COMPANY", legalName: "OUTRA", tradeName: "OUTRA" };
const SEM_REFERENCIA = { publicId: "33333333-3333-4333-8333-333333333333", type: "COMPANY", legalName: "SEM REF", tradeName: "SEM REF" };

interface Cenario {
  readonly referenciaExiste?: boolean;
  readonly totalReferenciasAtivas?: number;
  readonly identidade?: { status: string } | null;
  readonly acessoConcedido?: boolean;
  readonly contexto?: PortalContextResult;
  /** Referências ACTIVE de PCTEC_HELPDESK por organização. */
  readonly referenciasPorOrganizacao?: Record<string, number | undefined>;
  readonly totalReferenciasPorOrganizacao?: Record<string, number>;
}

function montar(cenario: Cenario = {}) {
  const chamadas = { autorizacao: [] as unknown[], contexto: [] as string[] };

  const service = new GetHelpdeskUserContextService(
    {
      execute: async () => {
        if (cenario.referenciaExiste === false) {
          throw new IdentityExternalReferenceNotFoundError("PCTEC_HELPDESK", "users", "99");
        }
        return { getIdentityPublicId: () => IDENTITY_PUBLIC_ID };
      }
    } as never,
    {
      countActiveBySystemCodeEntityTypeAndLegacyId: async () => cenario.totalReferenciasAtivas ?? 1
    } as never,
    {
      findByPublicId: async () =>
        cenario.identidade === null
          ? undefined
          : { getStatus: () => ({ toString: () => cenario.identidade?.status ?? "ACTIVE" }) }
    } as never,
    {
      execute: async (req: unknown) => {
        chamadas.autorizacao.push(req);
        if (cenario.acessoConcedido === false) {
          throw new ApplicationAccessDeniedError("ACCESS_NOT_GRANTED");
        }
        return {};
      }
    } as never,
    {
      execute: async (id: string) => {
        chamadas.contexto.push(id);
        return (
          cenario.contexto ?? { identityPublicId: IDENTITY_PUBLIC_ID, organizations: [BOSQUE] }
        );
      }
    } as never,
    {
      countActiveByOrganizationSystemCodeAndEntityType: async (publicId: { toString(): string }) =>
        cenario.totalReferenciasPorOrganizacao?.[publicId.toString()] ?? 1,
      findActiveByOrganizationSystemCodeAndEntityType: async (publicId: { toString(): string }) => {
        const mapa = cenario.referenciasPorOrganizacao ?? { [BOSQUE.publicId]: CLIENT_ID_SINTETICO };
        const legacyId = mapa[publicId.toString()];
        return legacyId === undefined ? undefined : { getLegacyId: () => ({ toNumber: () => legacyId }) };
      }
    } as never
  );

  return { service, chamadas };
}

describe("contexto do usuário do Helpdesk — pipeline", () => {
  it("resolve pela referência externa e devolve as organizações autorizadas", async () => {
    const { service, chamadas } = montar();
    const resultado = await service.execute(35);

    expect(resultado.organizations).toEqual([{ ...BOSQUE, sourceClientId: CLIENT_ID_SINTETICO }]);
    expect(chamadas.contexto).toEqual([IDENTITY_PUBLIC_ID]);
  });

  it("exige ApplicationAccess de PCTEC_HELPDESK com perfil USER", async () => {
    const { service, chamadas } = montar();
    await service.execute(35);

    expect(chamadas.autorizacao).toEqual([
      { identityPublicId: IDENTITY_PUBLIC_ID, applicationCode: "PCTEC_HELPDESK", requiredProfile: "USER" }
    ]);
  });

  it("404 quando não há referência ACTIVE — usuário ainda não gerenciado", async () => {
    const { service } = montar({ referenciaExiste: false });
    await expect(service.execute(45)).rejects.toThrow(IdentityExternalReferenceNotFoundError);
  });

  it("409 quando há mais de uma referência ACTIVE — ambiguidade não vira escolha", async () => {
    const { service } = montar({ totalReferenciasAtivas: 2 });
    await expect(service.execute(35)).rejects.toThrow(HelpdeskReferenceAmbiguousError);
  });

  it("409 quando a referência aponta para identidade inexistente", async () => {
    const { service } = montar({ identidade: null });
    await expect(service.execute(35)).rejects.toThrow(HelpdeskContextInconsistentError);
  });

  it.each(["INACTIVE", "BLOCKED", "PENDING", "DELETED"])(
    "403 quando a identidade está %s",
    async (status) => {
      const { service } = montar({ identidade: { status } });
      await expect(service.execute(35)).rejects.toThrow(HelpdeskIdentityNotActiveError);
    }
  );

  it("403 quando o acesso foi revogado", async () => {
    const { service } = montar({ acessoConcedido: false });
    await expect(service.execute(35)).rejects.toThrow(ApplicationAccessDeniedError);
  });

  it("não chama autorização nem contexto quando a identidade não está ACTIVE", async () => {
    const { service, chamadas } = montar({ identidade: { status: "INACTIVE" } });
    await expect(service.execute(35)).rejects.toThrow();

    expect(chamadas.autorizacao).toEqual([]);
    expect(chamadas.contexto).toEqual([]);
  });

  it("devolve exatamente o que o serviço de escopo organizacional resolveu, sem reinterpretar", async () => {
    // ORGANIZATION_ONLY e AND_DESCENDANTS são decididos lá — aqui só
    // provamos que nada é acrescentado nem filtrado no caminho.
    const grupoEFilhas: PortalContextResult = {
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizations: [
        GRUPO,
        BOSQUE,
        OUTRA
      ]
    };
    const { service } = montar({
      contexto: grupoEFilhas,
      referenciasPorOrganizacao: {
        [GRUPO.publicId]: 999901,
        [BOSQUE.publicId]: CLIENT_ID_SINTETICO,
        [OUTRA.publicId]: 999902
      }
    });
    const resultado = await service.execute(44);

    expect(resultado.organizations.map((o) => o.publicId)).toEqual(
      grupoEFilhas.organizations.map((o) => o.publicId)
    );
    expect(resultado.organizations.map((o) => o.sourceClientId)).toEqual([999901, CLIENT_ID_SINTETICO, 999902]);
  });

  it("409 quando a organização autorizada não tem referência de PCTEC_HELPDESK", async () => {
    const { service } = montar({ referenciasPorOrganizacao: {} });
    await expect(service.execute(35)).rejects.toThrow(HelpdeskContextInconsistentError);
  });

  it("409 quando a organização tem mais de uma referência ACTIVE", async () => {
    const { service } = montar({ totalReferenciasPorOrganizacao: { [BOSQUE.publicId]: 2 } });
    await expect(service.execute(35)).rejects.toThrow(HelpdeskContextInconsistentError);
  });

  it.each([0, -1, 1.5])("409 quando o id legado da referência é inválido (%s)", async (legacyId) => {
    const { service } = montar({ referenciasPorOrganizacao: { [BOSQUE.publicId]: legacyId } });
    await expect(service.execute(35)).rejects.toThrow(HelpdeskContextInconsistentError);
  });

  it("uma organização sem referência derruba o contexto inteiro — nunca some da lista em silêncio", async () => {
    const duas: PortalContextResult = {
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizations: [BOSQUE, SEM_REFERENCIA]
    };
    const { service } = montar({
      contexto: duas,
      referenciasPorOrganizacao: { [BOSQUE.publicId]: CLIENT_ID_SINTETICO }
    });
    await expect(service.execute(35)).rejects.toThrow(HelpdeskContextInconsistentError);
  });

  it("o resultado não carrega identityPublicId nem qualquer dado pessoal", async () => {
    const { service } = montar();
    const resultado = await service.execute(35);

    expect(Object.keys(resultado)).toEqual(["organizations"]);
    const serializado = JSON.stringify(resultado).toLowerCase();
    for (const proibido of ["identitypublicid", "email", "cpf", "password", "senha", "token", "hash", "credential"]) {
      expect(serializado).not.toContain(proibido);
    }
  });
});
