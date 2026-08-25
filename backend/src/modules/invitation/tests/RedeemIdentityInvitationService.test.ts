import { describe, expect, it } from "vitest";
import { Identity } from "../../identity/domain/Identity.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { CredentialRepository } from "../../security/domain/CredentialRepository.js";
import type { Credential } from "../../security/domain/Credential.js";
import { PasswordHash } from "../../security/domain/value-objects/PasswordHash.js";
import { CredentialPasswordPolicyViolationError } from "../../security/domain/value-objects/PlainPassword.js";
import { RedeemIdentityInvitationService } from "../application/RedeemIdentityInvitationService.js";
import { Invitation } from "../domain/Invitation.js";
import { InvitationNotUsableError } from "../domain/errors/InvitationErrors.js";
import { hashInvitationToken } from "../infrastructure/token/invitationToken.js";
import { FakeAuditEventRepository, FakeInvitationRepository, FakeUnitOfWork } from "./invitationTestSupport.js";

const IDENTIDADE = "11111111-1111-4111-8111-111111111111";
const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const TOKEN = "token-sintetico-de-convite";
const SENHA = "senha-sintetica-longa";
const AGORA = new Date("2026-01-01T12:00:00.000Z");

class FakeIdentityRepository implements IdentityRepository {
  public atualizacoes: Array<{ loginEnabled: boolean; expectedVersion: number }> = [];
  public constructor(private readonly identity: Identity | undefined) {}
  public async findByPublicId(): Promise<Identity | undefined> {
    return this.identity;
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
  public async update(identity: Identity, expectedVersion: number): Promise<void> {
    this.atualizacoes.push({ loginEnabled: identity.isLoginEnabled(), expectedVersion });
  }
}

class FakeCredentialRepository implements CredentialRepository {
  public readonly inseridas: Credential[] = [];
  public existente: Credential | undefined;
  public async insert(credential: Credential): Promise<void> {
    this.inseridas.push(credential);
  }
  public async findByIdentityAndType(): Promise<Credential | undefined> {
    return this.existente;
  }
  public async update(): Promise<void> {}
  public async existsAnyByType(): Promise<boolean> {
    return false;
  }
}

function identidade(status = "ACTIVE", loginEnabled = false): Identity {
  return Identity.reconstitute({
    internalId: 1,
    publicId: IDENTIDADE,
    type: "HUMAN",
    fullName: "Pessoa Federada",
    email: "federada@example.invalid",
    emailNormalized: "federada@example.invalid",
    status,
    loginEnabled,
    version: 4,
    createdAt: AGORA,
    updatedAt: AGORA
  });
}

function montar(opcoes: { status?: string; loginEnabled?: boolean; comCredencial?: boolean; expirado?: boolean } = {}) {
  const convites = new FakeInvitationRepository();
  const convite = Invitation.create({
    identityPublicId: IDENTIDADE,
    tokenHash: hashInvitationToken(TOKEN),
    invitedByPublicId: ADMIN,
    deliveryMode: "MANUAL_DEV",
    ttlSeconds: opcoes.expirado === true ? 1 : 86_400,
    correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ...(opcoes.expirado === true ? { now: new Date(Date.now() - 10_000) } : {})
  });
  void convites.insert(convite);

  const identityRepository = new FakeIdentityRepository(identidade(opcoes.status, opcoes.loginEnabled));
  const credenciais = new FakeCredentialRepository();
  if (opcoes.comCredencial === true) {
    credenciais.existente = {} as Credential;
  }
  const auditoria = new FakeAuditEventRepository();

  return {
    convites,
    credenciais,
    auditoria,
    identityRepository,
    service: new RedeemIdentityInvitationService(
      new FakeUnitOfWork(),
      () => convites,
      () => identityRepository,
      () => credenciais,
      () => auditoria,
      { hash: async () => PasswordHash.fromPersistence("$argon2id$v=19$m=1,t=1,p=1$c2ludGV0aWNv$c2ludGV0aWNv") },
      convites,
      identityRepository
    )
  };
}

describe("consumo do convite", () => {
  it("cria UMA credencial e habilita o login", async () => {
    const cenario = montar();
    const resultado = await cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA });

    expect(resultado.identityPublicId).toBe(IDENTIDADE);
    expect(cenario.credenciais.inseridas).toHaveLength(1);
    expect(resultado.loginEnabled).toBe(true);
    expect(cenario.identityRepository.atualizacoes).toEqual([{ loginEnabled: true, expectedVersion: 4 }]);
  });

  it("o evento de credencial tem a PRÓPRIA pessoa como ator — nunca BOOTSTRAP", async () => {
    const cenario = montar();
    await cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA });

    const criacao = cenario.auditoria.eventos.find((evento) => evento.eventType === "credential.created");
    expect(criacao?.actorPublicId).toBe(IDENTIDADE);
    expect(criacao?.actorPublicId).not.toBe("BOOTSTRAP");
  });

  it("audita criação da credencial, habilitação de login e consumo do convite", async () => {
    const cenario = montar();
    await cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA });

    expect(cenario.auditoria.tipos()).toContain("identity-invitation.consumed");
    const serializado = JSON.stringify(cenario.auditoria.eventos);
    expect(serializado).not.toContain(TOKEN);
    expect(serializado).not.toContain(SENHA);
    expect(serializado).not.toContain(hashInvitationToken(TOKEN));
  });

  it("REPLAY: o segundo uso do mesmo token falha", async () => {
    const cenario = montar();
    await cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA });

    await expect(
      cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA })
    ).rejects.toBeInstanceOf(InvitationNotUsableError);
    expect(cenario.credenciais.inseridas).toHaveLength(1);
  });

  it("CONCORRÊNCIA: dois consumos simultâneos criam uma única credencial", async () => {
    const cenario = montar();
    const resultados = await Promise.allSettled([
      cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA }),
      cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA })
    ]);

    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(cenario.credenciais.inseridas).toHaveLength(1);
  });

  it("convite expirado é recusado", async () => {
    const cenario = montar({ expirado: true });
    await expect(
      cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA })
    ).rejects.toBeInstanceOf(InvitationNotUsableError);
  });

  it("token desconhecido é recusado com o MESMO erro de um replay", async () => {
    const cenario = montar();
    await expect(
      cenario.service.execute({ token: "outro-token", password: SENHA, passwordConfirmation: SENHA })
    ).rejects.toBeInstanceOf(InvitationNotUsableError);
  });

  it("política de senha é aplicada ANTES do consumo — errar a senha não queima o convite", async () => {
    const cenario = montar();
    await expect(
      cenario.service.execute({ token: TOKEN, password: "curta", passwordConfirmation: "curta" })
    ).rejects.toBeInstanceOf(CredentialPasswordPolicyViolationError);

    // O convite continua válido: um erro de digitação não pode custar um
    // novo pedido ao administrador.
    const resultado = await cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA });
    expect(resultado.loginEnabled).toBe(true);
  });

  it("confirmação divergente é recusada sem tocar no convite", async () => {
    const cenario = montar();
    await expect(
      cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: `${SENHA}x` })
    ).rejects.toBeInstanceOf(CredentialPasswordPolicyViolationError);
    expect(cenario.credenciais.inseridas).toHaveLength(0);
  });

  it("identidade que já tem credencial é recusada, mesmo com convite válido", async () => {
    const cenario = montar({ comCredencial: true });
    await expect(
      cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA })
    ).rejects.toBeInstanceOf(InvitationNotUsableError);
    expect(cenario.credenciais.inseridas).toHaveLength(0);
  });

  it("identidade não ACTIVE é recusada", async () => {
    const cenario = montar({ status: "BLOCKED" });
    await expect(
      cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA })
    ).rejects.toBeInstanceOf(InvitationNotUsableError);
  });

  it("preview NÃO consome o convite", async () => {
    const cenario = montar();
    const previa = await cenario.service.preview(TOKEN);

    expect(previa.fullName).toBe("Pessoa Federada");
    // Recarregar a página não pode custar o acesso de quem tem direito a ele.
    await expect(cenario.service.preview(TOKEN)).resolves.toBeDefined();
    await expect(
      cenario.service.execute({ token: TOKEN, password: SENHA, passwordConfirmation: SENHA })
    ).resolves.toBeDefined();
  });

  it("preview de token inválido não revela se ele já existiu", async () => {
    const cenario = montar();
    await expect(cenario.service.preview("inexistente")).rejects.toBeInstanceOf(InvitationNotUsableError);
  });
});
