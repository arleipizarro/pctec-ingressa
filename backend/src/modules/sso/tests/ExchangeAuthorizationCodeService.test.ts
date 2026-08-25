import { describe, expect, it, beforeEach } from "vitest";
import { Identity } from "../../identity/domain/Identity.js";
import { Application } from "../../application/domain/Application.js";
import { ApplicationAccess } from "../../application/domain/ApplicationAccess.js";
import { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import {
  FakeApplicationAccessRepository,
  FakeApplicationRepository
} from "../../authorization/tests/FakeAuthorizationRepositories.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { ExchangeAuthorizationCodeService } from "../application/ExchangeAuthorizationCodeService.js";
import { AuthorizationCode } from "../domain/AuthorizationCode.js";
import { SsoAuthorizationCodeExchangeFailedError } from "../domain/errors/SsoErrors.js";
import { hashAuthorizationCode } from "../infrastructure/token/hashAuthorizationCode.js";
import { deriveCodeChallengeS256 } from "../infrastructure/token/pkce.js";
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
const VERIFIER = "verificador-sintetico-com-quarenta-e-tres-caracteres";
const DESAFIO = deriveCodeChallengeS256(VERIFIER);
const CODIGO = "codigo-bruto-sintetico";

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

function aplicacao(publicId: string, code: string, status = "ACTIVE"): Application {
  return Application.reconstitute({
    internalId: 1,
    publicId,
    code,
    name: code,
    status,
    version: 1,
    createdAt: AGORA,
    updatedAt: AGORA
  });
}

function acessoConcedido(): ApplicationAccess {
  return ApplicationAccess.reconstitute({
    internalId: 1,
    publicId: "55555555-5555-4555-8555-555555555555",
    identityPublicId: IDENTIDADE_PUBLIC_ID,
    applicationPublicId: APLICACAO_PORTAL_PUBLIC_ID,
    accessProfile: "USER",
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

interface Cenario {
  readonly service: ExchangeAuthorizationCodeService;
  readonly codigos: FakeAuthorizationCodeRepository;
  readonly auditoria: FakeAuditEventRepository;
}

function montar(
  opcoes: {
    identity?: Identity | undefined;
    concederAcesso?: boolean;
    audienciaPublicId?: string;
    expiraEm?: Date;
    redirectUriDoCodigo?: string;
  } = {}
): Cenario {
  const aplicacoes = new FakeApplicationRepository();
  aplicacoes.byCode.set("PCTEC_PORTAL", aplicacao(APLICACAO_PORTAL_PUBLIC_ID, "PCTEC_PORTAL"));
  aplicacoes.byCode.set("PCTEC_HELPDESK", aplicacao(APLICACAO_OUTRA_PUBLIC_ID, "PCTEC_HELPDESK"));

  const acessos = new FakeApplicationAccessRepository();
  if (opcoes.concederAcesso !== false) {
    acessos.byIdentityAndApplication.set(`${IDENTIDADE_PUBLIC_ID}:${APLICACAO_PORTAL_PUBLIC_ID}`, acessoConcedido());
  }

  const codigos = new FakeAuthorizationCodeRepository();
  const codigo = AuthorizationCode.issue({
    identityPublicId: IDENTIDADE_PUBLIC_ID,
    audienceApplicationPublicId: opcoes.audienciaPublicId ?? APLICACAO_PORTAL_PUBLIC_ID,
    audienceApplicationCode: "PCTEC_PORTAL",
    codeHash: hashAuthorizationCode(CODIGO),
    redirectUri: opcoes.redirectUriDoCodigo ?? REDIRECT_URI,
    codeChallenge: DESAFIO,
    ttlSeconds: 60,
    correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...(opcoes.expiraEm === undefined ? {} : { now: new Date(opcoes.expiraEm.getTime() - 60_000) })
  });
  void codigos.insert(codigo);

  const auditoria = new FakeAuditEventRepository();
  return {
    codigos,
    auditoria,
    service: new ExchangeAuthorizationCodeService(
      new FakeUnitOfWork(),
      () => codigos,
      () => aplicacoes,
      () => auditoria,
      new FakeIdentityRepository("identity" in opcoes ? opcoes.identity : identidade()),
      new AuthorizeApplicationAccessService(aplicacoes, acessos)
    )
  };
}

const TROCA = {
  code: CODIGO,
  codeVerifier: VERIFIER,
  redirectUri: REDIRECT_URI,
  clientId: "PCTEC_PORTAL",
  requiredProfile: "USER"
};

describe("troca do código de autorização", () => {
  let cenario: Cenario;

  beforeEach(() => {
    cenario = montar();
  });

  it("devolve apenas identidade, nome, aplicação/perfil e correlação", async () => {
    const resultado = await cenario.service.execute(TROCA);

    expect(resultado).toEqual({
      identityPublicId: IDENTIDADE_PUBLIC_ID,
      fullName: "Pessoa Sintetica",
      applicationCode: "PCTEC_PORTAL",
      accessProfile: "USER",
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    });
    // Nada de token, cookie, hash ou senha atravessa a fronteira.
    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain(CODIGO);
    expect(serializado).not.toContain(VERIFIER);
    expect(serializado).not.toContain(DESAFIO);
  });

  it("REPLAY: o segundo uso do mesmo código falha", async () => {
    await cenario.service.execute(TROCA);
    await expect(cenario.service.execute(TROCA)).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("redirect_uri diferente do da emissão falha", async () => {
    await expect(
      cenario.service.execute({ ...TROCA, redirectUri: "https://portal.example.invalid/outro" })
    ).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("code_verifier errado falha — e QUEIMA o código", async () => {
    await expect(
      cenario.service.execute({ ...TROCA, codeVerifier: `${VERIFIER.slice(0, -1)}Z` })
    ).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);

    // Uma tentativa é uma tentativa: o verifier correto não recupera o
    // código depois. Sem isso, quem interceptasse o código poderia
    // tentar adivinhar o verifier indefinidamente.
    await expect(cenario.service.execute(TROCA)).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("client_id diferente do audience falha", async () => {
    await expect(cenario.service.execute({ ...TROCA, clientId: "PCTEC_HELPDESK" })).rejects.toBeInstanceOf(
      SsoAuthorizationCodeExchangeFailedError
    );
  });

  it("código expirado falha", async () => {
    const expirado = montar({ expiraEm: new Date(Date.now() - 1_000) });
    await expect(expirado.service.execute(TROCA)).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("código inexistente falha com o MESMO erro de um replay", async () => {
    await expect(cenario.service.execute({ ...TROCA, code: "outro-codigo" })).rejects.toBeInstanceOf(
      SsoAuthorizationCodeExchangeFailedError
    );
  });

  it("acesso revogado entre a emissão e a troca impede a sessão", async () => {
    const revogado = montar({ concederAcesso: false });
    await expect(revogado.service.execute(TROCA)).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("Identity desativada entre a emissão e a troca impede a sessão", async () => {
    const inativa = montar({ identity: identidade({ status: "INACTIVE" }) });
    await expect(inativa.service.execute(TROCA)).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("login desabilitado entre a emissão e a troca impede a sessão", async () => {
    const semLogin = montar({ identity: identidade({ loginEnabled: false }) });
    await expect(semLogin.service.execute(TROCA)).rejects.toBeInstanceOf(SsoAuthorizationCodeExchangeFailedError);
  });

  it("todas as causas de falha têm a MESMA mensagem externa", async () => {
    const mensagens = new Set<string>();
    for (const tentativa of [
      { ...TROCA, code: "inexistente" },
      { ...TROCA, redirectUri: "https://portal.example.invalid/outro" },
      { ...TROCA, codeVerifier: `${VERIFIER.slice(0, -1)}Z` }
    ]) {
      const isolado = montar();
      await isolado.service.execute(tentativa).catch((erro: Error) => mensagens.add(erro.message));
    }
    expect(mensagens.size).toBe(1);
  });

  it("audita o consumo sem levar código, hash ou verifier no evento", async () => {
    await cenario.service.execute(TROCA);

    expect(cenario.auditoria.tipos()).toEqual(["sso.authorization-code.consumed"]);
    const serializado = JSON.stringify(cenario.auditoria.eventos);
    expect(serializado).not.toContain(CODIGO);
    expect(serializado).not.toContain(VERIFIER);
    expect(serializado).not.toContain(hashAuthorizationCode(CODIGO));
  });

  it("CONCORRÊNCIA: duas trocas simultâneas do mesmo código — só uma vence", async () => {
    const resultados = await Promise.allSettled([
      cenario.service.execute(TROCA),
      cenario.service.execute(TROCA)
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});
