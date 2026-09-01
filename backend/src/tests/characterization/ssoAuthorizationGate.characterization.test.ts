/**
 * Testes de CARACTERIZAÇÃO do portão de autorização do SSO —
 * fundação PCTEC Meu RH (FASE 3).
 *
 * Escritos ANTES de qualquer refatoração, contra o comportamento que já
 * existe hoje, para que a separação do gate (FASE 4) seja provada como
 * refatoração e não como mudança de política de segurança.
 *
 * **O que estes testes congelam** (numeração da task):
 *
 *   1. Portal sem Membership utilizável → RECUSADO.
 *   2. `ApplicationAccess` ausente → RECUSADO.
 *   3. Identity bloqueada → RECUSADA.
 *   4. `login_enabled = false` → RECUSADO.
 *   5. O código emitido carrega PKCE S256, audience e é de uso único
 *      (as proteções de replay/audience vivem em `AuthorizationCode` e
 *      em `ExchangeAuthorizationCodeService`, exercitadas aqui de ponta
 *      a ponta a partir do que a emissão persiste).
 *
 * **O que estes testes deliberadamente NÃO fazem:** afirmar COMO a
 * exigência de vínculo organizacional chega ao serviço. Antes da FASE 4
 * ela é um colaborador fixo (`GetPortalContextService`) do serviço
 * genérico; depois, uma política declarada pelo cliente `PCTEC_PORTAL`.
 * As asserções abaixo falam só do resultado observável — recusa ou
 * emissão — e por isso valem nos dois desenhos.
 *
 * Nenhum dado real: e-mails em `@example.invalid` (reservado por RFC),
 * public_ids sintéticos, nenhum acesso a banco.
 */
import { describe, expect, it } from "vitest";

import { Identity } from "../../modules/identity/domain/Identity.js";
import type { IdentityRepository } from "../../modules/identity/domain/IdentityRepository.js";
import { Application } from "../../modules/application/domain/Application.js";
import { ApplicationAccess } from "../../modules/application/domain/ApplicationAccess.js";
import { AuthorizeApplicationAccessService } from "../../modules/authorization/application/AuthorizeApplicationAccessService.js";
import { ApplicationAccessDeniedError } from "../../modules/authorization/domain/errors/AuthorizationErrors.js";
import {
  FakeApplicationAccessRepository,
  FakeApplicationRepository
} from "../../modules/authorization/tests/FakeAuthorizationRepositories.js";
import type { GetPortalContextService } from "../../modules/portal/application/GetPortalContextService.js";
import { IssueAuthorizationCodeService } from "../../modules/sso/application/IssueAuthorizationCodeService.js";
import { SsoIssuancePolicyRegistry } from "../../modules/sso/domain/SsoIssuancePolicy.js";
import { RequirePortalOrganizationContextPolicy } from "../../modules/portal/application/RequirePortalOrganizationContextPolicy.js";
import { ExchangeAuthorizationCodeService } from "../../modules/sso/application/ExchangeAuthorizationCodeService.js";
import { SsoAuthorizationDeniedError } from "../../modules/sso/domain/errors/SsoErrors.js";
import { SsoAuthorizationCodeExchangeFailedError } from "../../modules/sso/domain/errors/SsoErrors.js";
import { hashAuthorizationCode } from "../../modules/sso/infrastructure/token/hashAuthorizationCode.js";
import { deriveCodeChallengeS256 } from "../../modules/sso/infrastructure/token/pkce.js";
import {
  APLICACAO_PORTAL_PUBLIC_ID,
  FakeAuditEventRepository,
  FakeAuthorizationCodeRepository,
  FakeUnitOfWork,
  IDENTIDADE_PUBLIC_ID,
  ORGANIZACAO_PUBLIC_ID,
  REDIRECT_URI
} from "../../modules/sso/tests/ssoTestSupport.js";

const AGORA = new Date("2026-01-01T12:00:00.000Z");
const VERIFICADOR = "verificador-pkce-sintetico-com-tamanho-suficiente-1234567890";
const DESAFIO = deriveCodeChallengeS256(VERIFICADOR);

function identidade(overrides: { status?: string; loginEnabled?: boolean } = {}): Identity {
  return Identity.reconstitute({
    internalId: 1,
    publicId: IDENTIDADE_PUBLIC_ID,
    type: "HUMAN",
    fullName: "Pessoa Sintetica",
    email: "pessoa@example.invalid",
    emailNormalized: "pessoa@example.invalid",
    status: overrides.status ?? "ACTIVE",
    loginEnabled: overrides.loginEnabled ?? true,
    version: 3,
    createdAt: AGORA,
    updatedAt: AGORA
  });
}

function aplicacaoPortal(status = "ACTIVE"): Application {
  return Application.reconstitute({
    internalId: 1,
    publicId: APLICACAO_PORTAL_PUBLIC_ID,
    code: "PCTEC_PORTAL",
    name: "PCTEC Portal",
    status,
    version: 1,
    createdAt: AGORA,
    updatedAt: AGORA
  });
}

function acessoConcedido(profile = "USER"): ApplicationAccess {
  return ApplicationAccess.reconstitute({
    internalId: 1,
    publicId: "55555555-5555-4555-8555-555555555555",
    identityPublicId: IDENTIDADE_PUBLIC_ID,
    applicationPublicId: APLICACAO_PORTAL_PUBLIC_ID,
    accessProfile: profile,
    status: "GRANTED",
    grantedAt: AGORA,
    version: 1,
    createdAt: AGORA,
    updatedAt: AGORA
  });
}

class FakeIdentityRepository implements IdentityRepository {
  public constructor(private readonly encontrada: Identity | undefined) {}
  public async findByPublicId(): Promise<Identity | undefined> {
    return this.encontrada;
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

/**
 * Contexto organizacional sintético. `quantidade = 0` representa a
 * pessoa que tem acesso ao Portal mas nenhum vínculo empresarial
 * utilizável — o caso 1 desta caracterização.
 */
function contextoPortal(quantidade: number): GetPortalContextService {
  return {
    execute: async (identityPublicId: string) => ({
      identityPublicId,
      organizations: Array.from({ length: quantidade }, (_, indice) => ({
        publicId: `${ORGANIZACAO_PUBLIC_ID.slice(0, -1)}${indice}`,
        type: "COMPANY",
        legalName: "Empresa Sintetica",
        tradeName: undefined
      }))
    })
  } as unknown as GetPortalContextService;
}

interface Cenario {
  readonly emissao: IssueAuthorizationCodeService;
  readonly troca: ExchangeAuthorizationCodeService;
  readonly codigos: FakeAuthorizationCodeRepository;
  readonly auditoria: FakeAuditEventRepository;
}

function montarPortal(
  opcoes: {
    identity?: Identity | undefined;
    application?: Application;
    access?: ApplicationAccess | undefined;
    organizacoes?: number;
  } = {}
): Cenario {
  const aplicacoes = new FakeApplicationRepository();
  aplicacoes.byCode.set("PCTEC_PORTAL", opcoes.application ?? aplicacaoPortal());
  const acessos = new FakeApplicationAccessRepository();
  const acesso = "access" in opcoes ? opcoes.access : acessoConcedido();
  if (acesso !== undefined) {
    acessos.byIdentityAndApplication.set(`${IDENTIDADE_PUBLIC_ID}:${APLICACAO_PORTAL_PUBLIC_ID}`, acesso);
  }
  const codigos = new FakeAuthorizationCodeRepository();
  const auditoria = new FakeAuditEventRepository();
  const identidadeAlvo = "identity" in opcoes ? opcoes.identity : identidade();
  const identityRepository = new FakeIdentityRepository(identidadeAlvo);
  const autorizacao = new AuthorizeApplicationAccessService(aplicacoes, acessos);

  return {
    codigos,
    auditoria,
    emissao: new IssueAuthorizationCodeService(
      new FakeUnitOfWork(),
      () => identityRepository,
      () => aplicacoes,
      () => codigos,
      () => auditoria,
      autorizacao,
      // ÚNICA linha que a FASE 4 mudou neste arquivo: onde antes o
      // serviço genérico recebia `GetPortalContextService` direto, agora
      // recebe o registro de políticas, e a exigência do Portal chega
      // por `RequirePortalOrganizationContextPolicy`. TODAS as
      // asserções abaixo permaneceram idênticas — é isso que prova que
      // a separação foi refatoração, e não mudança de política.
      new SsoIssuancePolicyRegistry({
        PCTEC_PORTAL: [new RequirePortalOrganizationContextPolicy(contextoPortal(opcoes.organizacoes ?? 2))]
      }),
      { generate: () => "codigo-bruto-sintetico" },
      60
    ),
    troca: new ExchangeAuthorizationCodeService(
      new FakeUnitOfWork(),
      () => codigos,
      () => aplicacoes,
      () => auditoria,
      identityRepository,
      autorizacao
    )
  };
}

const PEDIDO_PORTAL = {
  identityPublicId: IDENTIDADE_PUBLIC_ID,
  applicationCode: "PCTEC_PORTAL",
  requiredProfile: "USER",
  redirectUri: REDIRECT_URI,
  codeChallenge: DESAFIO
};

describe("caracterização — o Portal continua exigindo vínculo organizacional", () => {
  it("1. sem nenhuma Organization utilizável, a emissão é RECUSADA e nada é persistido", async () => {
    const cenario = montarPortal({ organizacoes: 0 });

    await expect(cenario.emissao.execute(PEDIDO_PORTAL)).rejects.toBeInstanceOf(SsoAuthorizationDeniedError);
    expect(cenario.codigos.codigos.size).toBe(0);
    expect(cenario.auditoria.eventos).toHaveLength(0);
  });

  it("1b. com ao menos uma Organization utilizável, a emissão acontece", async () => {
    const cenario = montarPortal({ organizacoes: 1 });

    const resultado = await cenario.emissao.execute(PEDIDO_PORTAL);

    expect(resultado.code).toBe("codigo-bruto-sintetico");
    expect(cenario.codigos.codigos.size).toBe(1);
  });
});

describe("caracterização — invariantes de acesso que valem para QUALQUER aplicação", () => {
  it("2. ApplicationAccess ausente → recusado", async () => {
    const cenario = montarPortal({ access: undefined });

    await expect(cenario.emissao.execute(PEDIDO_PORTAL)).rejects.toBeInstanceOf(ApplicationAccessDeniedError);
    expect(cenario.codigos.codigos.size).toBe(0);
  });

  it("2b. Application inativa → recusado, mesmo com acesso concedido", async () => {
    const cenario = montarPortal({ application: aplicacaoPortal("INACTIVE") });

    await expect(cenario.emissao.execute(PEDIDO_PORTAL)).rejects.toBeInstanceOf(ApplicationAccessDeniedError);
  });

  it("3. Identity bloqueada → recusada", async () => {
    const cenario = montarPortal({ identity: identidade({ status: "BLOCKED" }) });

    await expect(cenario.emissao.execute(PEDIDO_PORTAL)).rejects.toBeInstanceOf(SsoAuthorizationDeniedError);
    expect(cenario.codigos.codigos.size).toBe(0);
  });

  it("4. login_enabled = false → recusado", async () => {
    const cenario = montarPortal({ identity: identidade({ loginEnabled: false }) });

    await expect(cenario.emissao.execute(PEDIDO_PORTAL)).rejects.toBeInstanceOf(SsoAuthorizationDeniedError);
    expect(cenario.codigos.codigos.size).toBe(0);
  });
});

describe("caracterização — PKCE, audience e replay do authorization code", () => {
  it("5a. o código persistido guarda só o hash, com desafio S256 e audience da aplicação", async () => {
    const cenario = montarPortal();
    await cenario.emissao.execute(PEDIDO_PORTAL);

    const persistido = [...cenario.codigos.codigos.values()][0]!;
    expect(persistido.getCodeHash()).toBe(hashAuthorizationCode("codigo-bruto-sintetico"));
    expect(persistido.getCodeChallenge()).toBe(DESAFIO);
    expect(persistido.getCodeChallengeMethod()).toBe("S256");
    expect(persistido.getAudienceApplicationPublicId()).toBe(APLICACAO_PORTAL_PUBLIC_ID);
    expect(JSON.stringify([...cenario.codigos.codigos.values()])).not.toContain("codigo-bruto-sintetico");
  });

  it("5b. a troca exige o code_verifier correto — verificador errado é recusado", async () => {
    const cenario = montarPortal();
    const emitido = await cenario.emissao.execute(PEDIDO_PORTAL);

    await expect(
      cenario.troca.execute({
        code: emitido.code,
        codeVerifier: "verificador-errado-mas-com-tamanho-suficiente-0987654321",
        redirectUri: REDIRECT_URI,
        clientId: "PCTEC_PORTAL",
        requiredProfile: "USER"
      })
    ).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("5c. a troca exige o mesmo redirect_uri da emissão", async () => {
    const cenario = montarPortal();
    const emitido = await cenario.emissao.execute(PEDIDO_PORTAL);

    await expect(
      cenario.troca.execute({
        code: emitido.code,
        codeVerifier: VERIFICADOR,
        redirectUri: "https://portal.example.invalid/api/auth/ingressa/outro-callback",
        clientId: "PCTEC_PORTAL",
        requiredProfile: "USER"
      })
    ).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("5d. a troca exige que o client_id seja o audience do código", async () => {
    const cenario = montarPortal();
    const emitido = await cenario.emissao.execute(PEDIDO_PORTAL);

    await expect(
      cenario.troca.execute({
        code: emitido.code,
        codeVerifier: VERIFICADOR,
        redirectUri: REDIRECT_URI,
        clientId: "PCTEC_OUTRO",
        requiredProfile: "USER"
      })
    ).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("5e. REPLAY: o mesmo código nunca é trocado duas vezes", async () => {
    const cenario = montarPortal();
    const emitido = await cenario.emissao.execute(PEDIDO_PORTAL);
    const troca = {
      code: emitido.code,
      codeVerifier: VERIFICADOR,
      redirectUri: REDIRECT_URI,
      clientId: "PCTEC_PORTAL",
      requiredProfile: "USER"
    };

    await expect(cenario.troca.execute(troca)).resolves.toMatchObject({
      identityPublicId: IDENTIDADE_PUBLIC_ID,
      applicationCode: "PCTEC_PORTAL"
    });
    await expect(cenario.troca.execute(troca)).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });
});
