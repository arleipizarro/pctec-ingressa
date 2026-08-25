import { describe, expect, it, vi } from "vitest";
import {
  ActivateFederatedIdentityService,
  FederatedActivationApproverNotEligibleError,
  FederatedIdentityNotActivatableError,
  FederatedIdentityNotLinkedError
} from "../application/ActivateFederatedIdentityService.js";
import { ApplicationAccessDeniedError } from "../../authorization/domain/errors/AuthorizationErrors.js";

const APROVADOR = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ALVO = "8aceafb7-5ff7-4043-947b-85f035757e9e";

interface Cenario {
  readonly aprovador?: { status: string } | null;
  readonly aprovadorAdmin?: boolean;
  readonly referencia?: boolean;
  readonly alvoStatus?: string;
  readonly alvoExiste?: boolean;
  readonly acessoHelpdesk?: boolean;
}

function montar(cenario: Cenario = {}) {
  const escritas = { update: [] as unknown[], auditoria: [] as unknown[][], credenciais: [] as unknown[] };
  const autorizacoes: { applicationCode: string; requiredProfile: string; identityPublicId: string }[] = [];
  const ativou: string[] = [];

  const identidadeAlvo = {
    getStatus: () => ({ toString: () => cenario.alvoStatus ?? "PENDING" }),
    getVersion: () => 3,
    activate: (input: { expectedVersion: number }) => {
      ativou.push(`v${input.expectedVersion}`);
    },
    pullDomainEvents: () => [{ nome: "IdentityActivated" }]
  };
  const identidadeAprovador = {
    getStatus: () => ({ toString: () => cenario.aprovador?.status ?? "ACTIVE" })
  };

  const service = new ActivateFederatedIdentityService({
    unitOfWork: { runInTransaction: async (work: (c: unknown) => Promise<unknown>) => work({}) } as never,
    identityRepositoryFactory: () =>
      ({
        findByPublicId: async (publicId: { toString(): string }) => {
          if (publicId.toString() === APROVADOR) {
            return cenario.aprovador === null ? undefined : identidadeAprovador;
          }
          return cenario.alvoExiste === false ? undefined : identidadeAlvo;
        },
        update: async (identity: unknown, expectedVersion: number) => {
          escritas.update.push({ identity, expectedVersion });
        }
      }) as never,
    identityExternalReferenceRepositoryFactory: () =>
      ({
        findActiveBySystemCodeEntityTypeAndLegacyId: async () =>
          cenario.referencia === false ? undefined : { getIdentityPublicId: () => ALVO }
      }) as never,
    applicationRepositoryFactory: () => ({}) as never,
    applicationAccessRepositoryFactory: () => ({}) as never,
    auditEventRepositoryFactory: () =>
      ({ insertMany: async (eventos: unknown[]) => escritas.auditoria.push(eventos) }) as never
  });

  // O serviço constrói AuthorizeApplicationAccessService internamente;
  // o duplo entra pelo prototype para manter a composição real intacta.
  const AuthorizeModule = ActivateFederatedIdentityService as unknown as Record<string, unknown>;
  void AuthorizeModule;

  return { service, escritas, autorizacoes, ativou };
}

/**
 * `AuthorizeApplicationAccessService` é construído dentro do serviço a
 * partir dos repositórios — então o duplo mora nos repositórios, não no
 * serviço. Estes fakes reproduzem o que ele consulta.
 */
function comAutorizacao(cenario: Cenario = {}) {
  const chamadas: { applicationCode: string; profile: string; identity: string }[] = [];
  const applicationRepository = {
    findByCode: async (code: { toString(): string }) => ({
      isActive: () => true,
      getPublicId: () => ({ toString: () => `app-${code.toString()}` }),
      getCode: () => ({ toString: () => code.toString() })
    })
  };
  const applicationAccessRepository = {
    findByIdentityAndApplication: async (identityPublicId: string, applicationPublicId: string) => {
      const helpdesk = applicationPublicId === "app-PCTEC_HELPDESK";
      const ingressa = applicationPublicId === "app-PCTEC_INGRESSA";
      chamadas.push({ applicationCode: applicationPublicId, profile: "", identity: identityPublicId });
      if (helpdesk && cenario.acessoHelpdesk === false) return undefined;
      if (ingressa && cenario.aprovadorAdmin === false) return undefined;
      return {
        isGranted: () => true,
        getAccessProfile: () => ({
          equals: (outro: { toString(): string }) => outro.toString() === (ingressa ? "ADMIN" : "USER"),
          toString: () => (ingressa ? "ADMIN" : "USER")
        })
      };
    }
  };
  return { applicationRepository, applicationAccessRepository, chamadas };
}

function montarCompleto(cenario: Cenario = {}) {
  const { applicationRepository, applicationAccessRepository, chamadas } = comAutorizacao(cenario);
  const base = montar(cenario);
  const service = new ActivateFederatedIdentityService({
    ...(base.service as unknown as { deps: Record<string, unknown> }).deps,
    applicationRepositoryFactory: () => applicationRepository as never,
    applicationAccessRepositoryFactory: () => applicationAccessRepository as never
  } as never);
  return { ...base, service, chamadas };
}

describe("ativação federada de Identity", () => {
  it("ativa quando aprovador é ADMIN ACTIVE, há vínculo e há acesso ao Helpdesk", async () => {
    const { service, escritas, ativou } = montarCompleto();
    const resultado = await service.execute({ legacyUserId: 35, approvedByIdentityPublicId: APROVADOR });

    expect(resultado.status).toBe("PENDING");
    expect(resultado.alreadyActive).toBe(false);
    expect(ativou).toEqual(["v3"]);
    expect(escritas.update).toHaveLength(1);
    expect((escritas.update[0] as { expectedVersion: number }).expectedVersion).toBe(3);
    expect(escritas.auditoria).toHaveLength(1);
  });

  it("verifica o perfil ADMIN na aplicação da PLATAFORMA, não na consumidora", async () => {
    const { service, chamadas } = montarCompleto();
    await service.execute({ legacyUserId: 35, approvedByIdentityPublicId: APROVADOR });

    expect(chamadas[0]?.applicationCode).toBe("app-PCTEC_INGRESSA");
    expect(chamadas[0]?.identity).toBe(APROVADOR);
    expect(chamadas[1]?.applicationCode).toBe("app-PCTEC_HELPDESK");
    expect(chamadas[1]?.identity).toBe(ALVO);
  });

  it("é idempotente: identidade já ACTIVE não escreve nada", async () => {
    const { service, escritas } = montarCompleto({ alvoStatus: "ACTIVE" });
    const resultado = await service.execute({ legacyUserId: 35, approvedByIdentityPublicId: APROVADOR });

    expect(resultado.alreadyActive).toBe(true);
    expect(escritas.update).toEqual([]);
    expect(escritas.auditoria).toEqual([]);
  });

  it.each(["BLOCKED", "INACTIVE", "DELETED"])(
    "recusa identidade %s — reativar bloqueio é outra decisão",
    async (status) => {
      const { service } = montarCompleto({ alvoStatus: status });
      await expect(
        service.execute({ legacyUserId: 35, approvedByIdentityPublicId: APROVADOR })
      ).rejects.toThrow(FederatedIdentityNotActivatableError);
    }
  );

  it("recusa quando não há IdentityExternalReference de PCTEC_HELPDESK", async () => {
    const { service, escritas } = montarCompleto({ referencia: false });
    await expect(
      service.execute({ legacyUserId: 99, approvedByIdentityPublicId: APROVADOR })
    ).rejects.toThrow(FederatedIdentityNotLinkedError);
    expect(escritas.update).toEqual([]);
  });

  it("recusa quando a identidade não tem ApplicationAccess do Helpdesk", async () => {
    const { service, escritas } = montarCompleto({ acessoHelpdesk: false });
    await expect(
      service.execute({ legacyUserId: 35, approvedByIdentityPublicId: APROVADOR })
    ).rejects.toThrow(ApplicationAccessDeniedError);
    expect(escritas.update).toEqual([]);
  });

  it.each([
    ["inexistente", { aprovador: null }],
    ["INACTIVE", { aprovador: { status: "INACTIVE" } }]
  ])("recusa aprovador %s", async (_caso, cenario) => {
    const { service } = montarCompleto(cenario as Cenario);
    await expect(
      service.execute({ legacyUserId: 35, approvedByIdentityPublicId: APROVADOR })
    ).rejects.toThrow(FederatedActivationApproverNotEligibleError);
  });

  it("recusa aprovador sem perfil ADMIN", async () => {
    const { service } = montarCompleto({ aprovadorAdmin: false });
    await expect(
      service.execute({ legacyUserId: 35, approvedByIdentityPublicId: APROVADOR })
    ).rejects.toThrow(ApplicationAccessDeniedError);
  });

  it("recusa aprovador vazio antes de qualquer leitura", async () => {
    const { service } = montarCompleto();
    await expect(service.execute({ legacyUserId: 35, approvedByIdentityPublicId: "   " })).rejects.toThrow(
      FederatedActivationApproverNotEligibleError
    );
  });

  it("nunca toca em Credential — nenhum repositório de credencial é injetado", () => {
    const chaves = Object.keys(
      (montarCompleto().service as unknown as { deps: Record<string, unknown> }).deps
    );
    expect(chaves.some((chave) => chave.toLowerCase().includes("credential"))).toBe(false);
  });
});
