import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { Identity } from "../../identity/domain/Identity.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import { Credential } from "../../security/domain/Credential.js";
import type { CredentialRepository } from "../../security/domain/CredentialRepository.js";
import { Session } from "../../security/domain/session/Session.js";
import type { SessionRepository } from "../../security/domain/session/SessionRepository.js";
import { PasswordHash } from "../../security/domain/value-objects/PasswordHash.js";
import type { CredentialType } from "../../security/domain/value-objects/CredentialType.js";
import { CompletePasswordResetService } from "../application/CompletePasswordResetService.js";
import type {
  PasswordResetDelivery,
  PasswordResetDeliveryMode,
  PasswordResetDeliveryRequest
} from "../application/PasswordResetDelivery.js";
import { RequestPasswordResetService } from "../application/RequestPasswordResetService.js";
import type { PasswordResetToken } from "../domain/PasswordResetToken.js";
import type { PasswordResetTokenRepository } from "../domain/PasswordResetTokenRepository.js";

export const TITULAR = "11111111-1111-4111-8111-111111111111";
export const EMAIL_TITULAR = "titular@example.invalid";
export const SENHA_ANTIGA_PHC = "$argon2id$v=19$m=1,t=1,p=1$YW50aWdh$YW50aWdh";
export const SENHA_NOVA_PHC = "$argon2id$v=19$m=1,t=1,p=1$bm92YQ$bm92YQ";
export const SENHA_NOVA = "senha-nova-sintetica-longa";
export const BASE = "https://ingressa.example.invalid";
export const T0 = new Date("2026-03-01T12:00:00.000Z");

/** Transação sem banco: o "mundo" em memória já é compartilhado. */
export class FakeUnitOfWork implements UnitOfWork {
  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    return work({ execute: async () => [[], []] });
  }
}

export class FakeAuditEventRepository implements AuditEventRepository {
  public readonly eventos: AuditEvent[] = [];
  public async insert(event: AuditEvent): Promise<void> {
    this.eventos.push(event);
  }
  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    this.eventos.push(...events);
  }
  public tipos(): readonly string[] {
    return this.eventos.map((evento) => evento.eventType);
  }
  public doTipo(tipo: string): readonly AuditEvent[] {
    return this.eventos.filter((evento) => evento.eventType === tipo);
  }
}

/**
 * Pedidos em memória com a MESMA semântica do MariaDB: consumo só do que
 * está PENDING e dentro da validade, marcado no mesmo passo. É ela que
 * os testes de reuso e expiração exercitam.
 */
export class FakePasswordResetTokenRepository implements PasswordResetTokenRepository {
  public readonly todos: PasswordResetToken[] = [];

  public async insert(token: PasswordResetToken): Promise<void> {
    this.todos.push(token);
  }

  public async revokePendingByIdentity(identityPublicId: string, now: Date, reason: string): Promise<number> {
    const pendentes = this.todos.filter(
      (t) => t.getIdentityPublicId() === identityPublicId && t.getStatus() === "PENDING"
    );
    for (const token of pendentes) {
      token.markRevoked(now, reason);
    }
    return pendentes.length;
  }

  public async countCreatedSince(identityPublicId: string, since: Date): Promise<number> {
    return this.todos.filter(
      (t) => t.getIdentityPublicId() === identityPublicId && t.getCreatedAt().getTime() >= since.getTime()
    ).length;
  }

  public async findUsableByTokenHash(tokenHash: string, now: Date): Promise<PasswordResetToken | undefined> {
    const token = this.todos.find((t) => t.getTokenHash() === tokenHash);
    return token !== undefined && token.isUsable(now) ? token : undefined;
  }

  public async consumeByTokenHash(tokenHash: string, now: Date): Promise<PasswordResetToken | undefined> {
    const token = this.todos.find((t) => t.getTokenHash() === tokenHash);
    if (token === undefined || !token.isUsable(now)) {
      return undefined;
    }
    token.markConsumed(now);
    return token;
  }
}

export class FakeIdentityRepository implements IdentityRepository {
  public readonly identidades: Identity[] = [];

  public async findByPublicId(publicId: IdentityPublicId): Promise<Identity | undefined> {
    return this.identidades.find((i) => i.getPublicId().toString() === publicId.toString());
  }
  public async findByNormalizedEmail(normalizedEmail: string): Promise<Identity | undefined> {
    return this.identidades.find((i) => i.getEmail().toString().toLowerCase() === normalizedEmail);
  }
  public async existsByNormalizedEmail(): Promise<boolean> {
    return false;
  }
  public async existsByNormalizedCpf(): Promise<boolean> {
    return false;
  }
  public async countAll(): Promise<number> {
    return this.identidades.length;
  }
  public async insert(): Promise<void> {}
  public async update(): Promise<void> {}
}

export class FakeCredentialRepository implements CredentialRepository {
  public readonly credenciais: Credential[] = [];
  public atualizacoes = 0;

  public async insert(credential: Credential): Promise<void> {
    this.credenciais.push(credential);
  }
  public async findByIdentityAndType(identityPublicId: string, type: CredentialType): Promise<Credential | undefined> {
    return this.credenciais.find(
      (c) => c.getIdentityPublicId() === identityPublicId && c.getType().toString() === type.toString()
    );
  }
  public async update(): Promise<void> {
    this.atualizacoes += 1;
  }
  public async existsAnyByType(): Promise<boolean> {
    return this.credenciais.length > 0;
  }
}

export class FakeSessionRepository implements SessionRepository {
  public readonly sessoes: Session[] = [];
  public async insert(session: Session): Promise<void> {
    this.sessoes.push(session);
  }
  public async findByTokenHash(): Promise<Session | undefined> {
    return undefined;
  }
  public async findByPublicId(): Promise<Session | undefined> {
    return undefined;
  }
  public async findActiveByIdentityPublicId(identityPublicId: string): Promise<readonly Session[]> {
    return this.sessoes.filter(
      (s) => s.getIdentityPublicId() === identityPublicId && s.getStatus() === "ACTIVE"
    );
  }
  public async update(): Promise<void> {}
}

/** Guarda o que seria enviado — inclusive o link, que só o teste lê. */
export class CapturingDelivery implements PasswordResetDelivery {
  public readonly mode: PasswordResetDeliveryMode = "EMAIL";
  public readonly enviados: PasswordResetDeliveryRequest[] = [];
  public falhar = false;

  public async deliver(request: PasswordResetDeliveryRequest): Promise<void> {
    if (this.falhar) {
      throw new Error("smtp recusou: envelope com link " + request.link);
    }
    this.enviados.push(request);
  }

  /** Token do último link, lido do FRAGMENTO. */
  public ultimoToken(): string {
    const ultimo = this.enviados.at(-1);
    if (ultimo === undefined) {
      throw new Error("nenhum e-mail capturado");
    }
    return ultimo.link.split("#")[1] ?? "";
  }
}

export function identidade(
  opcoes: { publicId?: string; email?: string; status?: string; loginEnabled?: boolean } = {}
): Identity {
  const email = opcoes.email ?? EMAIL_TITULAR;
  return Identity.reconstitute({
    internalId: 1,
    publicId: opcoes.publicId ?? TITULAR,
    type: "HUMAN",
    fullName: "Pessoa Titular",
    email,
    emailNormalized: email.toLowerCase(),
    status: opcoes.status ?? "ACTIVE",
    loginEnabled: opcoes.loginEnabled ?? true,
    version: 3,
    createdAt: T0,
    updatedAt: T0
  });
}

export function credencial(identityPublicId = TITULAR, status = "ACTIVE"): Credential {
  return Credential.reconstitute({
    internalId: 1,
    publicId: "22222222-2222-4222-8222-222222222222",
    identityPublicId,
    type: "LOCAL_PASSWORD",
    passwordHash: SENHA_ANTIGA_PHC,
    status,
    lastAuthenticatedAt: undefined,
    version: 5,
    createdAt: T0,
    updatedAt: T0
  });
}

export function sessaoAtiva(publicId: string, identityPublicId = TITULAR): Session {
  return Session.reconstitute({
    internalId: 1,
    publicId,
    identityPublicId,
    tokenHash: "a".repeat(64),
    status: "ACTIVE",
    createdAt: T0,
    expiresAt: new Date(T0.getTime() + 86_400_000),
    version: 1
  });
}

/**
 * Monta os dois serviços REAIS sobre o mesmo mundo em memória, com
 * relógio controlado. O titular padrão é ACTIVE, com login habilitado,
 * credencial ativa e duas sessões abertas.
 */
export function montarMundo(
  opcoes: { status?: string; loginEnabled?: boolean; semCredencial?: boolean; ttlSeconds?: number } = {}
) {
  let agora = T0;
  const relogio = (): Date => agora;
  const identities = new FakeIdentityRepository();
  identities.identidades.push(
    identidade({
      ...(opcoes.status !== undefined ? { status: opcoes.status } : {}),
      ...(opcoes.loginEnabled !== undefined ? { loginEnabled: opcoes.loginEnabled } : {})
    })
  );
  const credentials = new FakeCredentialRepository();
  if (opcoes.semCredencial !== true) {
    credentials.credenciais.push(credencial());
  }
  const sessions = new FakeSessionRepository();
  sessions.sessoes.push(
    sessaoAtiva("33333333-3333-4333-8333-333333333333"),
    sessaoAtiva("44444444-4444-4444-8444-444444444444")
  );
  const tokens = new FakePasswordResetTokenRepository();
  const auditoria = new FakeAuditEventRepository();
  const entrega = new CapturingDelivery();
  let sequencia = 0;
  const hashes: string[] = [];

  const pedido = new RequestPasswordResetService({
    unitOfWork: new FakeUnitOfWork(),
    identityRepository: identities,
    credentialRepository: credentials,
    passwordResetTokenRepositoryFactory: () => tokens,
    auditEventRepositoryFactory: () => auditoria,
    auditEventRepository: auditoria,
    // Tokens distintos e previsíveis — o teste precisa conferir que o
    // valor em claro não aparece em lugar nenhum além do link.
    tokenGenerator: { generate: () => `token-sintetico-${(sequencia += 1)}-${"x".repeat(32)}` },
    delivery: entrega,
    ttlSeconds: opcoes.ttlSeconds ?? 1_800,
    publicBaseUrl: `${BASE}/`,
    now: relogio
  });

  const conclusao = new CompletePasswordResetService({
    unitOfWork: new FakeUnitOfWork(),
    passwordResetTokenRepositoryFactory: () => tokens,
    identityRepositoryFactory: () => identities,
    credentialRepositoryFactory: () => credentials,
    sessionRepositoryFactory: () => sessions,
    auditEventRepositoryFactory: () => auditoria,
    passwordHasher: {
      hash: async (senha) => {
        hashes.push(senha.revealForHashing());
        return PasswordHash.fromPersistence(SENHA_NOVA_PHC);
      }
    },
    readOnlyPasswordResetTokenRepository: tokens,
    readOnlyIdentityRepository: identities,
    now: relogio
  });

  return {
    pedido,
    conclusao,
    identities,
    credentials,
    sessions,
    tokens,
    auditoria,
    entrega,
    hashes,
    avancar(segundos: number): void {
      agora = new Date(agora.getTime() + segundos * 1000);
    }
  };
}
