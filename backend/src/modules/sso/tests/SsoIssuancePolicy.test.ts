/**
 * Prova da FASE 4: o serviço genérico de emissão do SSO deixou de
 * depender de contexto organizacional.
 *
 * Os dois lados da separação são exercitados aqui SEM registrar nenhuma
 * aplicação nova no catálogo (D9) — a abstração é testada diretamente,
 * que é o que a task pediu:
 *
 *   - uma aplicação genérica, que declara lista VAZIA de políticas,
 *     emite código com `ApplicationAccess` válido + Identity válida e
 *     NENHUM Membership em lugar nenhum. Nem sequer existe um
 *     `GetPortalContextService` nesta montagem — a ausência é a prova;
 *   - o Portal, que declara a política de contexto organizacional,
 *     continua sendo recusado sem Organization utilizável;
 *   - um cliente sem declaração nenhuma é recusado (fail-closed), para
 *     que esquecer de declarar nunca vire "produto sem exigências".
 */
import { describe, expect, it } from "vitest";

import { Identity } from "../../identity/domain/Identity.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { Application } from "../../application/domain/Application.js";
import { ApplicationAccess } from "../../application/domain/ApplicationAccess.js";
import { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import {
  FakeApplicationAccessRepository,
  FakeApplicationRepository
} from "../../authorization/tests/FakeAuthorizationRepositories.js";
import type { GetPortalContextService } from "../../portal/application/GetPortalContextService.js";
import { RequirePortalOrganizationContextPolicy } from "../../portal/application/RequirePortalOrganizationContextPolicy.js";
import { IssueAuthorizationCodeService } from "../application/IssueAuthorizationCodeService.js";
import { SsoIssuancePolicyRegistry, type SsoIssuancePolicy } from "../domain/SsoIssuancePolicy.js";
import { SsoAuthorizationDeniedError } from "../domain/errors/SsoErrors.js";
import {
  APLICACAO_OUTRA_PUBLIC_ID,
  APLICACAO_PORTAL_PUBLIC_ID,
  FakeAuditEventRepository,
  FakeAuthorizationCodeRepository,
  FakeUnitOfWork,
  IDENTIDADE_PUBLIC_ID,
  REDIRECT_URI
} from "./ssoTestSupport.js";

const AGORA = new Date("2026-01-01T12:00:00.000Z");
const DESAFIO = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

/**
 * Código de aplicação puramente sintético — NÃO é `PCTEC_MEU_RH` e não
 * é registrado em lugar nenhum do catálogo. Serve só para exercitar a
 * abstração "uma aplicação que não exige contexto organizacional".
 */
const APLICACAO_GENERICA = "PCTEC_APP_SINTETICA";

function identidadeAtiva(): Identity {
  return Identity.reconstitute({
    internalId: 1,
    publicId: IDENTIDADE_PUBLIC_ID,
    type: "HUMAN",
    fullName: "Pessoa Sintetica",
    email: "pessoa@example.invalid",
    emailNormalized: "pessoa@example.invalid",
    status: "ACTIVE",
    loginEnabled: true,
    version: 1,
    createdAt: AGORA,
    updatedAt: AGORA
  });
}

function aplicacao(code: string, publicId: string): Application {
  return Application.reconstitute({
    internalId: 1,
    publicId,
    code,
    name: code,
    status: "ACTIVE",
    version: 1,
    createdAt: AGORA,
    updatedAt: AGORA
  });
}

function acesso(applicationPublicId: string): ApplicationAccess {
  return ApplicationAccess.reconstitute({
    internalId: 1,
    publicId: "55555555-5555-4555-8555-555555555555",
    identityPublicId: IDENTIDADE_PUBLIC_ID,
    applicationPublicId,
    accessProfile: "USER",
    status: "GRANTED",
    grantedAt: AGORA,
    version: 1,
    createdAt: AGORA,
    updatedAt: AGORA
  });
}

class FakeIdentityRepository implements IdentityRepository {
  public async findByPublicId(): Promise<Identity> {
    return identidadeAtiva();
  }
  public async findByNormalizedEmail(): Promise<undefined> {
    return undefined;
  }
  public async existsByNormalizedEmail(): Promise<boolean> {
    return false;
  }
  public async existsByNormalizedCpf(): Promise<boolean> {
    return false;
  }
  public async countAll(): Promise<number> {
    return 1;
  }
  public async insert(): Promise<void> {}
  public async update(): Promise<void> {}
}

function contextoSemOrganizacoes(): GetPortalContextService {
  return {
    execute: async (identityPublicId: string) => ({ identityPublicId, organizations: [] })
  } as unknown as GetPortalContextService;
}

function montar(
  applicationCode: string,
  applicationPublicId: string,
  declaracoes: Readonly<Record<string, readonly SsoIssuancePolicy[]>>
): { service: IssueAuthorizationCodeService; codigos: FakeAuthorizationCodeRepository } {
  const aplicacoes = new FakeApplicationRepository();
  aplicacoes.byCode.set(applicationCode, aplicacao(applicationCode, applicationPublicId));
  const acessos = new FakeApplicationAccessRepository();
  acessos.byIdentityAndApplication.set(`${IDENTIDADE_PUBLIC_ID}:${applicationPublicId}`, acesso(applicationPublicId));
  const codigos = new FakeAuthorizationCodeRepository();

  return {
    codigos,
    service: new IssueAuthorizationCodeService(
      new FakeUnitOfWork(),
      () => new FakeIdentityRepository(),
      () => aplicacoes,
      () => codigos,
      () => new FakeAuditEventRepository(),
      new AuthorizeApplicationAccessService(aplicacoes, acessos),
      new SsoIssuancePolicyRegistry(declaracoes),
      { generate: () => "codigo-bruto-sintetico" },
      60
    )
  };
}

function pedido(applicationCode: string): Parameters<IssueAuthorizationCodeService["execute"]>[0] {
  return {
    identityPublicId: IDENTIDADE_PUBLIC_ID,
    applicationCode,
    requiredProfile: "USER",
    redirectUri: REDIRECT_URI,
    codeChallenge: DESAFIO
  };
}

describe("emissão SSO — aplicação genérica não depende de Membership", () => {
  it("com ApplicationAccess válido e Identity válida, emite sem NENHUM contexto organizacional envolvido", async () => {
    // Repare na montagem: nenhum `GetPortalContextService`, nenhum
    // MembershipRepository, nenhuma Organization. Se o serviço genérico
    // ainda dependesse de vínculo, esta montagem sequer compilaria.
    const cenario = montar(APLICACAO_GENERICA, APLICACAO_OUTRA_PUBLIC_ID, { [APLICACAO_GENERICA]: [] });

    const resultado = await cenario.service.execute(pedido(APLICACAO_GENERICA));

    expect(resultado.code).toBe("codigo-bruto-sintetico");
    expect(cenario.codigos.codigos.size).toBe(1);
  });

  it("as invariantes de segurança do SSO continuam valendo para ela — acesso não concedido segue recusado", async () => {
    const aplicacoes = new FakeApplicationRepository();
    aplicacoes.byCode.set(APLICACAO_GENERICA, aplicacao(APLICACAO_GENERICA, APLICACAO_OUTRA_PUBLIC_ID));
    const codigos = new FakeAuthorizationCodeRepository();
    const service = new IssueAuthorizationCodeService(
      new FakeUnitOfWork(),
      () => new FakeIdentityRepository(),
      () => aplicacoes,
      () => codigos,
      () => new FakeAuditEventRepository(),
      // Repositório de acessos VAZIO — nenhum ApplicationAccess.
      new AuthorizeApplicationAccessService(aplicacoes, new FakeApplicationAccessRepository()),
      new SsoIssuancePolicyRegistry({ [APLICACAO_GENERICA]: [] }),
      { generate: () => "codigo-bruto-sintetico" },
      60
    );

    await expect(service.execute(pedido(APLICACAO_GENERICA))).rejects.toThrow();
    expect(codigos.codigos.size).toBe(0);
  });
});

describe("emissão SSO — o Portal continua exigindo contexto organizacional", () => {
  it("sem Organization utilizável, a política do Portal recusa a emissão", async () => {
    const cenario = montar("PCTEC_PORTAL", APLICACAO_PORTAL_PUBLIC_ID, {
      PCTEC_PORTAL: [new RequirePortalOrganizationContextPolicy(contextoSemOrganizacoes())]
    });

    await expect(cenario.service.execute(pedido("PCTEC_PORTAL"))).rejects.toBeInstanceOf(SsoAuthorizationDeniedError);
    expect(cenario.codigos.codigos.size).toBe(0);
  });

  it("a recusa preserva o motivo interno NO_USABLE_MEMBERSHIP", async () => {
    const cenario = montar("PCTEC_PORTAL", APLICACAO_PORTAL_PUBLIC_ID, {
      PCTEC_PORTAL: [new RequirePortalOrganizationContextPolicy(contextoSemOrganizacoes())]
    });

    await expect(cenario.service.execute(pedido("PCTEC_PORTAL"))).rejects.toMatchObject({
      reason: "NO_USABLE_MEMBERSHIP",
      code: "SSO_AUTHORIZATION_DENIED"
    });
  });
});

describe("SsoIssuancePolicyRegistry — declaração obrigatória", () => {
  it("um cliente SEM declaração é recusado (fail-closed), nunca tratado como sem exigências", async () => {
    const cenario = montar(APLICACAO_GENERICA, APLICACAO_OUTRA_PUBLIC_ID, {});

    await expect(cenario.service.execute(pedido(APLICACAO_GENERICA))).rejects.toMatchObject({
      reason: "ISSUANCE_POLICY_NOT_DECLARED"
    });
    expect(cenario.codigos.codigos.size).toBe(0);
  });

  it("lista vazia declarada é uma resposta válida e DIFERENTE de ausência", () => {
    const registro = new SsoIssuancePolicyRegistry({ [APLICACAO_GENERICA]: [] });

    expect(registro.isDeclaredFor(APLICACAO_GENERICA)).toBe(true);
    expect(registro.requireFor(APLICACAO_GENERICA)).toEqual([]);
    expect(registro.isDeclaredFor("PCTEC_PORTAL")).toBe(false);
    expect(() => registro.requireFor("PCTEC_PORTAL")).toThrow(SsoAuthorizationDeniedError);
  });

  it("todas as políticas declaradas são avaliadas, e a primeira recusa interrompe", async () => {
    const avaliadas: string[] = [];
    const politica = (name: string, recusa: boolean): SsoIssuancePolicy => ({
      name,
      evaluate: async () => {
        avaliadas.push(name);
        if (recusa) {
          throw new SsoAuthorizationDeniedError(`RECUSADA_${name}`);
        }
      }
    });
    const cenario = montar(APLICACAO_GENERICA, APLICACAO_OUTRA_PUBLIC_ID, {
      [APLICACAO_GENERICA]: [politica("primeira", false), politica("segunda", true), politica("terceira", false)]
    });

    await expect(cenario.service.execute(pedido(APLICACAO_GENERICA))).rejects.toMatchObject({
      reason: "RECUSADA_segunda"
    });
    expect(avaliadas).toEqual(["primeira", "segunda"]);
    expect(cenario.codigos.codigos.size).toBe(0);
  });
});
