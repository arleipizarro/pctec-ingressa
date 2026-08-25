import { describe, expect, it, beforeEach } from "vitest";
import { Identity } from "../../identity/domain/Identity.js";
import { Application } from "../../application/domain/Application.js";
import { ApplicationAccess } from "../../application/domain/ApplicationAccess.js";
import { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import {
  FakeApplicationAccessRepository,
  FakeApplicationRepository
} from "../../authorization/tests/FakeAuthorizationRepositories.js";
import type { GetPortalContextService } from "../../portal/application/GetPortalContextService.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId } from "../../identity/domain/value-objects/PublicId.js";
import { IssueAuthorizationCodeService } from "../application/IssueAuthorizationCodeService.js";
import { MAX_AUTHORIZATION_CODE_TTL_SECONDS } from "../domain/AuthorizationCode.js";
import { SsoAuthorizationDeniedError } from "../domain/errors/SsoErrors.js";
import { ApplicationAccessDeniedError } from "../../authorization/domain/errors/AuthorizationErrors.js";
import { hashAuthorizationCode } from "../infrastructure/token/hashAuthorizationCode.js";
import {
  APLICACAO_PORTAL_PUBLIC_ID,
  FakeAuditEventRepository,
  FakeAuthorizationCodeRepository,
  FakeUnitOfWork,
  IDENTIDADE_PUBLIC_ID,
  ORGANIZACAO_PUBLIC_ID,
  REDIRECT_URI
} from "./ssoTestSupport.js";

const DESAFIO = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const AGORA = new Date("2026-01-01T12:00:00.000Z");

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
  public async findByPublicId(_publicId: PublicId): Promise<Identity | undefined> {
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

function contexto(quantidadeDeOrganizacoes: number): GetPortalContextService {
  return {
    execute: async (identityPublicId: string) => ({
      identityPublicId,
      organizations: Array.from({ length: quantidadeDeOrganizacoes }, (_, indice) => ({
        publicId: `${ORGANIZACAO_PUBLIC_ID.slice(0, -1)}${indice}`,
        type: "COMPANY",
        legalName: "Empresa Sintetica",
        tradeName: undefined
      }))
    })
  } as unknown as GetPortalContextService;
}

interface Cenario {
  readonly service: IssueAuthorizationCodeService;
  readonly codigos: FakeAuthorizationCodeRepository;
  readonly auditoria: FakeAuditEventRepository;
}

function montar(
  opcoes: {
    identity?: Identity | undefined;
    application?: Application;
    access?: ApplicationAccess | undefined;
    organizacoes?: number;
    ttlSeconds?: number;
  } = {}
): Cenario {
  const aplicacoes = new FakeApplicationRepository();
  aplicacoes.byCode.set("PCTEC_PORTAL", opcoes.application ?? aplicacaoPortal());
  const acessos = new FakeApplicationAccessRepository();
  const acesso = opcoes.access === undefined && !("access" in opcoes) ? acessoConcedido() : opcoes.access;
  if (acesso !== undefined) {
    acessos.byIdentityAndApplication.set(`${IDENTIDADE_PUBLIC_ID}:${APLICACAO_PORTAL_PUBLIC_ID}`, acesso);
  }
  const codigos = new FakeAuthorizationCodeRepository();
  const auditoria = new FakeAuditEventRepository();
  const identidadeAlvo = "identity" in opcoes ? opcoes.identity : identidade();

  return {
    codigos,
    auditoria,
    service: new IssueAuthorizationCodeService(
      new FakeUnitOfWork(),
      () => new FakeIdentityRepository(identidadeAlvo),
      () => aplicacoes,
      () => codigos,
      () => auditoria,
      new AuthorizeApplicationAccessService(aplicacoes, acessos),
      contexto(opcoes.organizacoes ?? 2),
      { generate: () => "codigo-bruto-sintetico" },
      opcoes.ttlSeconds ?? 60
    )
  };
}

const PEDIDO = {
  identityPublicId: IDENTIDADE_PUBLIC_ID,
  applicationCode: "PCTEC_PORTAL",
  requiredProfile: "USER",
  redirectUri: REDIRECT_URI,
  codeChallenge: DESAFIO
};

describe("emissão do código de autorização", () => {
  let cenario: Cenario;

  beforeEach(() => {
    cenario = montar();
  });

  it("emite o código e persiste SOMENTE o hash — nunca o valor bruto", async () => {
    const resultado = await cenario.service.execute(PEDIDO);

    expect(resultado.code).toBe("codigo-bruto-sintetico");
    const persistido = [...cenario.codigos.codigos.values()][0];
    expect(persistido?.getCodeHash()).toBe(hashAuthorizationCode("codigo-bruto-sintetico"));
    expect(JSON.stringify([...cenario.codigos.codigos.values()])).not.toContain("codigo-bruto-sintetico");
  });

  it("grava o redirect_uri exato e o desafio PKCE", async () => {
    await cenario.service.execute(PEDIDO);
    const persistido = [...cenario.codigos.codigos.values()][0];

    expect(persistido?.getRedirectUri()).toBe(REDIRECT_URI);
    expect(persistido?.getCodeChallenge()).toBe(DESAFIO);
    expect(persistido?.getCodeChallengeMethod()).toBe("S256");
  });

  it("a validade nunca passa de 60 segundos, mesmo pedindo mais", async () => {
    const generoso = montar({ ttlSeconds: 3_600 });
    await generoso.service.execute(PEDIDO);
    const persistido = [...generoso.codigos.codigos.values()][0]!;

    const duracao = (persistido.getExpiresAt().getTime() - persistido.getCreatedAt().getTime()) / 1000;
    expect(duracao).toBeLessThanOrEqual(MAX_AUTHORIZATION_CODE_TTL_SECONDS);
  });

  it("audita a emissão sem levar o código nem o hash no evento", async () => {
    await cenario.service.execute(PEDIDO);

    expect(cenario.auditoria.tipos()).toEqual(["sso.authorization-code.issued"]);
    const serializado = JSON.stringify(cenario.auditoria.eventos);
    expect(serializado).not.toContain("codigo-bruto-sintetico");
    expect(serializado).not.toContain(hashAuthorizationCode("codigo-bruto-sintetico"));
  });

  it("recusa quem não tem ApplicationAccess concedido", async () => {
    const semAcesso = montar({ access: undefined });
    await expect(semAcesso.service.execute(PEDIDO)).rejects.toBeInstanceOf(ApplicationAccessDeniedError);
    expect(semAcesso.codigos.codigos.size).toBe(0);
  });

  it("recusa quando a Application não está ACTIVE", async () => {
    const inativa = montar({ application: aplicacaoPortal("INACTIVE") });
    await expect(inativa.service.execute(PEDIDO)).rejects.toBeInstanceOf(ApplicationAccessDeniedError);
  });

  it("recusa quem não tem nenhum vínculo empresarial utilizável", async () => {
    const semVinculo = montar({ organizacoes: 0 });
    await expect(semVinculo.service.execute(PEDIDO)).rejects.toBeInstanceOf(SsoAuthorizationDeniedError);
    expect(semVinculo.codigos.codigos.size).toBe(0);
  });

  it("recusa Identity não ACTIVE mesmo com acesso concedido", async () => {
    const bloqueada = montar({ identity: identidade({ status: "BLOCKED" }) });
    await expect(bloqueada.service.execute(PEDIDO)).rejects.toBeInstanceOf(SsoAuthorizationDeniedError);
  });

  it("recusa Identity com login desabilitado", async () => {
    const semLogin = montar({ identity: identidade({ loginEnabled: false }) });
    await expect(semLogin.service.execute(PEDIDO)).rejects.toBeInstanceOf(SsoAuthorizationDeniedError);
  });

  it("recusa quando o perfil concedido não satisfaz o exigido", async () => {
    const outroPerfil = montar({ access: acessoConcedido("ADMIN") });
    await expect(outroPerfil.service.execute(PEDIDO)).rejects.toBeInstanceOf(ApplicationAccessDeniedError);
  });
});
