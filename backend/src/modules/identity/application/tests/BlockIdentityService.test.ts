import { describe, expect, it } from "vitest";
import { BlockIdentityService } from "../BlockIdentityService.js";
import { RevokeAllSessionsService } from "../../../security/application/RevokeAllSessionsService.js";
import { Identity } from "../../domain/Identity.js";
import { Session } from "../../../security/domain/session/Session.js";
import type { IdentityRepository } from "../../domain/IdentityRepository.js";
import type { SessionRevocationRepository } from "../../../security/application/RevokeAllSessionsService.js";
import type { UnitOfWork } from "../../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { AuditEventRepository } from "../../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../../audit/domain/AuditEvent.js";
import { IdentityNotFoundError, IdentityVersionConflictError } from "../../domain/errors/IdentityErrors.js";
import { InvalidIdentityStatusTransitionError } from "../../domain/value-objects/IdentityStatus.js";

const IDENTIDADE = "11111111-1111-4111-8111-111111111111";
const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const AGORA = new Date("2026-01-01T12:00:00.000Z");

class FakeUnitOfWork implements UnitOfWork {
  public revertida = false;
  public async runInTransaction<T>(work: (c: Queryable) => Promise<T>): Promise<T> {
    try {
      return await work({ execute: async () => [[], []] });
    } catch (erro) {
      // Marca o rollback para os testes de atomicidade: nada do que o
      // trabalho fez deve ser considerado efetivado.
      this.revertida = true;
      throw erro;
    }
  }
}

class FakeAuditEventRepository implements AuditEventRepository {
  public readonly eventos: AuditEvent[] = [];
  public async insert(e: AuditEvent): Promise<void> { this.eventos.push(e); }
  public async insertMany(e: readonly AuditEvent[]): Promise<void> { this.eventos.push(...e); }
  public tipos(): readonly string[] { return this.eventos.map((e) => e.eventType); }
}

function identidade(status = "ACTIVE", loginEnabled = true, version = 3): Identity {
  return Identity.reconstitute({
    internalId: 1, publicId: IDENTIDADE, type: "HUMAN",
    fullName: "Pessoa Sintetica", email: "pessoa@example.invalid", emailNormalized: "pessoa@example.invalid",
    status, loginEnabled, version, createdAt: AGORA, updatedAt: AGORA
  });
}

function sessao(publicId: string): Session {
  return Session.reconstitute({
    internalId: 1, publicId, identityPublicId: IDENTIDADE, tokenHash: "a".repeat(64),
    status: "ACTIVE", createdAt: AGORA, expiresAt: new Date(Date.now() + 3_600_000), version: 1
  });
}

class FakeIdentityRepository implements IdentityRepository {
  public atualizacoes: Array<{ status: string; expectedVersion: number }> = [];
  public constructor(private readonly encontrada: Identity | undefined) {}
  public async findByPublicId(): Promise<Identity | undefined> { return this.encontrada; }
  public async findByNormalizedEmail(): Promise<undefined> { return undefined; }
  public async existsByNormalizedEmail(): Promise<boolean> { return false; }
  public async existsByNormalizedCpf(): Promise<boolean> { return false; }
  public async countAll(): Promise<number> { return 1; }
  public async insert(): Promise<void> {}
  public async update(identity: Identity, expectedVersion: number): Promise<void> {
    this.atualizacoes.push({ status: identity.getStatus().toString(), expectedVersion });
  }
}

class FakeSessionRepository implements SessionRevocationRepository {
  public atualizadas: Session[] = [];
  public falharNaAtualizacao = false;
  public constructor(private readonly ativas: Session[]) {}
  public async findActiveByIdentityPublicId(): Promise<readonly Session[]> { return this.ativas; }
  public async update(s: Session): Promise<void> {
    if (this.falharNaAtualizacao) throw new Error("falha ao revogar sessão");
    this.atualizadas.push(s);
  }
}

function montar(opcoes: { identity?: Identity | undefined; sessoes?: Session[] } = {}) {
  const uow = new FakeUnitOfWork();
  const identityRepository = new FakeIdentityRepository("identity" in opcoes ? opcoes.identity : identidade());
  const sessionRepository = new FakeSessionRepository(opcoes.sessoes ?? []);
  const auditoria = new FakeAuditEventRepository();
  return {
    uow, identityRepository, sessionRepository, auditoria,
    service: new BlockIdentityService(uow, () => identityRepository, () => sessionRepository, () => auditoria)
  };
}

const PEDIDO = { identityPublicId: IDENTIDADE, actorPublicId: ADMIN, expectedVersion: 3 };

describe("bloqueio de Identity", () => {
  it("bloqueia e revoga TODAS as sessões ativas", async () => {
    const c = montar({ sessoes: [sessao("aaaaaaaa-1111-4111-8111-111111111111"), sessao("bbbbbbbb-1111-4111-8111-111111111111")] });

    const resultado = await c.service.execute(PEDIDO);

    expect(resultado.status).toBe("BLOCKED");
    expect(resultado.sessionsRevoked).toBe(2);
    expect(c.sessionRepository.atualizadas.every((s) => s.isRevoked())).toBe(true);
  });

  it("bloqueia sem sessões abertas — revoked: 0 não é erro", async () => {
    const resultado = await montar().service.execute(PEDIDO);
    expect(resultado.sessionsRevoked).toBe(0);
    expect(resultado.status).toBe("BLOCKED");
  });

  it("federada com login desabilitado também pode ser bloqueada", async () => {
    // É o caso que mais importa: ela nunca autentica no Ingressa, mas o
    // contexto que as aplicações consomem passa a ser negado.
    const c = montar({ identity: identidade("ACTIVE", false) });
    await expect(c.service.execute(PEDIDO)).resolves.toMatchObject({ status: "BLOCKED" });
  });

  it("audita bloqueio e revogações, com o ADMIN como ator", async () => {
    const c = montar({ sessoes: [sessao("aaaaaaaa-1111-4111-8111-111111111111")] });
    await c.service.execute(PEDIDO);

    expect(c.auditoria.tipos()).toEqual(expect.arrayContaining(["identity.blocked", "session.revoked"]));
    expect(c.auditoria.eventos.every((e) => e.actorPublicId === ADMIN)).toBe(true);
  });

  it("nenhum token ou hash de sessão aparece na auditoria", async () => {
    const c = montar({ sessoes: [sessao("aaaaaaaa-1111-4111-8111-111111111111")] });
    await c.service.execute(PEDIDO);

    expect(JSON.stringify(c.auditoria.eventos)).not.toContain("a".repeat(64));
  });

  it("ATOMICIDADE: falha ao revogar sessão desfaz o bloqueio", async () => {
    const c = montar({ sessoes: [sessao("aaaaaaaa-1111-4111-8111-111111111111")] });
    c.sessionRepository.falharNaAtualizacao = true;

    await expect(c.service.execute(PEDIDO)).rejects.toThrow();
    // Bloqueado com sessão viva seria o pior dos dois estados.
    expect(c.uow.revertida).toBe(true);
  });

  it("já bloqueada é CONFLITO explícito, nunca 'ok' silencioso", async () => {
    const c = montar({ identity: identidade("BLOCKED") });
    await expect(c.service.execute(PEDIDO)).rejects.toBeInstanceOf(InvalidIdentityStatusTransitionError);
  });

  it("versão desatualizada na tela vira conflito", async () => {
    const c = montar();
    await expect(c.service.execute({ ...PEDIDO, expectedVersion: 1 })).rejects.toBeInstanceOf(IdentityVersionConflictError);
  });

  it("identidade inexistente é recusada", async () => {
    const c = montar({ identity: undefined });
    await expect(c.service.execute(PEDIDO)).rejects.toBeInstanceOf(IdentityNotFoundError);
  });

  it("o bloqueio NÃO apaga nada — só muda status e versão", async () => {
    const c = montar();
    await c.service.execute(PEDIDO);

    expect(c.identityRepository.atualizacoes).toEqual([{ status: "BLOCKED", expectedVersion: 3 }]);
  });
});

describe("encerrar todas as sessões", () => {
  function montarRevogacao(sessoes: Session[]) {
    const uow = new FakeUnitOfWork();
    const sessionRepository = new FakeSessionRepository(sessoes);
    const auditoria = new FakeAuditEventRepository();
    return {
      sessionRepository, auditoria,
      service: new RevokeAllSessionsService(uow, () => sessionRepository, () => auditoria)
    };
  }

  it("revoga todas e conta quantas", async () => {
    const c = montarRevogacao([sessao("aaaaaaaa-1111-4111-8111-111111111111"), sessao("bbbbbbbb-1111-4111-8111-111111111111")]);
    await expect(c.service.execute({ identityPublicId: IDENTIDADE, actorPublicId: ADMIN })).resolves.toEqual({ revoked: 2 });
  });

  it("IDEMPOTENTE: sem sessões ativas, revoked = 0 e nenhum erro", async () => {
    const c = montarRevogacao([]);
    await expect(c.service.execute({ identityPublicId: IDENTIDADE, actorPublicId: ADMIN })).resolves.toEqual({ revoked: 0 });
    expect(c.auditoria.eventos).toHaveLength(0);
  });

  it("cada revogação é auditada com o ADMIN como ator", async () => {
    const c = montarRevogacao([sessao("aaaaaaaa-1111-4111-8111-111111111111")]);
    await c.service.execute({ identityPublicId: IDENTIDADE, actorPublicId: ADMIN });

    expect(c.auditoria.tipos()).toEqual(["session.revoked"]);
    expect(c.auditoria.eventos[0]?.actorPublicId).toBe(ADMIN);
  });
});
