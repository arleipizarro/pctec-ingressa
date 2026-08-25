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

interface Cenario {
  readonly referenciaExiste?: boolean;
  readonly totalReferenciasAtivas?: number;
  readonly identidade?: { status: string } | null;
  readonly acessoConcedido?: boolean;
  readonly contexto?: PortalContextResult;
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
    } as never
  );

  return { service, chamadas };
}

describe("contexto do usuário do Helpdesk — pipeline", () => {
  it("resolve pela referência externa e devolve as organizações autorizadas", async () => {
    const { service, chamadas } = montar();
    const resultado = await service.execute(35);

    expect(resultado.organizations).toEqual([BOSQUE]);
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
        { publicId: "grp-1", type: "BUSINESS_GROUP", legalName: "GRUPO", tradeName: "GRUPO" },
        BOSQUE,
        { publicId: "co-2", type: "COMPANY", legalName: "OUTRA", tradeName: "OUTRA" }
      ]
    };
    const { service } = montar({ contexto: grupoEFilhas });
    const resultado = await service.execute(44);

    expect(resultado.organizations).toEqual(grupoEFilhas.organizations);
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
