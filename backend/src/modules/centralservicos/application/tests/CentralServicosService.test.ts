/**
 * CentralServicosService — autorização fechada na própria aplicação e
 * asserções de delegação de uso único.
 *
 * Persistência em memória que REPRODUZ o que o MariaDB garante: unicidade
 * por ação do emissor e consumo atômico (`consumed_at IS NULL`).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID } from "../../../application/domain/value-objects/ApplicationCodes.js";
import type { CentralServicosRepository, IdentityAuthorizationRow } from "../../domain/CentralServicosRepository.js";
import type { DelegationAssertionRecord, NewDelegationAssertion } from "../../domain/DelegationAssertion.js";
import {
  CentralServicosService,
  type CentralServicosAuditEntry,
  type CentralServicosPersistence
} from "../CentralServicosService.js";
import {
  CentralServicosIdentityNotAuthorizedError,
  DelegationAssertionAlreadyIssuedError,
  DelegationAssertionInvalidInputError
} from "../errors/CentralServicosErrors.js";

const OPERADOR = "aaaaaaaa-0000-4000-8000-000000000001";
const SEM_PAPEL = "aaaaaaaa-0000-4000-8000-000000000002";
const SEM_ACESSO = "aaaaaaaa-0000-4000-8000-000000000003";
const BLOQUEADA = "aaaaaaaa-0000-4000-8000-000000000004";
const INEXISTENTE = "aaaaaaaa-0000-4000-8000-000000000009";

class PersistenciaEmMemoria implements CentralServicosPersistence, CentralServicosRepository {
  readonly identidades = new Map<string, IdentityAuthorizationRow>();
  readonly papeis = new Map<string, string[]>();
  readonly assercoes: DelegationAssertionRecord[] = [];
  readonly auditoria: CentralServicosAuditEntry[] = [];
  get leitura(): CentralServicosRepository {
    return this;
  }

  async transacao<T>(fn: (repo: CentralServicosRepository, auditar: (e: CentralServicosAuditEntry) => Promise<void>) => Promise<T>): Promise<T> {
    const pendentes: CentralServicosAuditEntry[] = [];
    const r = await fn(this, async (e) => void pendentes.push(e));
    this.auditoria.push(...pendentes);
    return r;
  }

  async identityAuthorization(id: string, app: string): Promise<IdentityAuthorizationRow | undefined> {
    expect(app).toBe(PCTEC_CENTRAL_SERVICOS_APPLICATION_PUBLIC_ID);
    return this.identidades.get(id);
  }
  async grantedRoles(id: string): Promise<readonly string[]> {
    return this.papeis.get(id) ?? [];
  }
  async insertAssertion(a: NewDelegationAssertion): Promise<void> {
    if (this.assercoes.some((x) => x.issuerApplicationPublicId === a.issuerApplicationPublicId && x.idempotencyKey === a.idempotencyKey)) {
      throw new DelegationAssertionAlreadyIssuedError();
    }
    this.assercoes.push({ ...a, id: this.assercoes.length + 1, consumedAt: null });
  }
  async assertionByTokenHash(h: string): Promise<DelegationAssertionRecord | undefined> {
    return this.assercoes.find((a) => a.tokenHash === h);
  }
  async consumeAssertion(id: number, _consumer: string, at: Date): Promise<boolean> {
    const i = this.assercoes.findIndex((a) => a.id === id && a.consumedAt === null);
    if (i < 0) return false;
    this.assercoes[i] = { ...this.assercoes[i]!, consumedAt: at };
    return true;
  }
  async applicationCodeByPublicId(): Promise<string | undefined> {
    return "PCTEC_CENTRAL_SERVICOS";
  }
}

function cenario() {
  let t = new Date("2026-09-25T12:00:00Z").getTime();
  const p = new PersistenciaEmMemoria();
  p.identidades.set(OPERADOR, { fullName: "Operador", status: "ACTIVE", accessProfile: "USER" });
  p.papeis.set(OPERADOR, ["N1_OPERADOR", "APROVADOR_TI"]);
  p.identidades.set(SEM_PAPEL, { fullName: "Sem papel", status: "ACTIVE", accessProfile: "USER" });
  p.identidades.set(SEM_ACESSO, { fullName: "Sem acesso", status: "ACTIVE", accessProfile: null });
  p.papeis.set(SEM_ACESSO, ["N1_OPERADOR"]); // papel órfão, sem camada 1
  p.identidades.set(BLOQUEADA, { fullName: "Bloqueada", status: "BLOCKED", accessProfile: "USER" });
  p.papeis.set(BLOQUEADA, ["N1_OPERADOR"]);
  const service = new CentralServicosService({ persistencia: p, agora: () => new Date(t), validadeAssercaoSegundos: 600 });
  return { p, service, avancar: (ms: number) => (t += ms) };
}

const ACAO = {
  ticketId: 101,
  idempotencyKey: "n1:00000000-0000-4000-8000-000000000001",
  actionKind: "ANDAMENTO_INTERNO",
  contentSha256: createHash("sha256").update("[Central] Triagem concluída").digest("hex")
};

describe("autorização da Central de Serviços", () => {
  it("devolve camada 1 e 2 só para identidade ACTIVE com acesso", async () => {
    const { service } = cenario();
    expect(await service.autorizacao(OPERADOR)).toEqual({
      identityPublicId: OPERADOR,
      fullName: "Operador",
      accessProfile: "USER",
      roles: ["N1_OPERADOR", "APROVADOR_TI"]
    });
    expect(await service.autorizacao(SEM_PAPEL)).toMatchObject({ accessProfile: "USER", roles: [] });
    // Papel sem acesso de camada 1 não vale nada — nem é devolvido.
    expect(await service.autorizacao(SEM_ACESSO)).toMatchObject({ accessProfile: null, roles: [] });
    expect(await service.autorizacao(BLOQUEADA)).toMatchObject({ accessProfile: null, roles: [] });
    expect(await service.autorizacao(INEXISTENTE)).toMatchObject({ accessProfile: null, roles: [] });
    await expect(service.autorizacao("nao-e-uuid")).rejects.toBeInstanceOf(DelegationAssertionInvalidInputError);
  });
});

describe("emissão de asserção", () => {
  it("recusa identidade sem papel, sem acesso ou bloqueada", async () => {
    const { service, p } = cenario();
    for (const id of [SEM_PAPEL, SEM_ACESSO, BLOQUEADA, INEXISTENTE]) {
      await expect(service.emitirAssercao({ identityPublicId: id, ...ACAO })).rejects.toBeInstanceOf(CentralServicosIdentityNotAuthorizedError);
    }
    expect(p.assercoes).toHaveLength(0);
  });

  it("valida a amarração da ação", async () => {
    const { service } = cenario();
    const invalidos: Record<string, unknown>[] = [
      { ticketId: 0 },
      { ticketId: "101" },
      { idempotencyKey: "curta" },
      { actionKind: "APAGAR_CHAMADO" },
      { contentSha256: "abc" }
    ];
    for (const extra of invalidos) {
      await expect(service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO, ...extra })).rejects.toBeInstanceOf(
        DelegationAssertionInvalidInputError
      );
    }
  });

  it("guarda só o hash do token, com validade, e uma asserção por ação", async () => {
    const { service, p } = cenario();
    const r = await service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO });
    expect(r.assertion).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.expiresAt).toBe("2026-09-25T12:10:00.000Z");
    expect(JSON.stringify(p.assercoes)).not.toContain(r.assertion);
    expect(p.assercoes[0]?.tokenHash).toBe(createHash("sha256").update(r.assertion).digest("hex"));
    expect(JSON.stringify(p.auditoria)).not.toContain(r.assertion);
    expect(p.auditoria.map((a) => a.eventType)).toEqual(["delegation-assertion.issued"]);

    await expect(service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO })).rejects.toBeInstanceOf(
      DelegationAssertionAlreadyIssuedError
    );
  });
});

describe("verificação de asserção pelo destinatário", () => {
  const verificar = (service: CentralServicosService, assertion: unknown, extra: Record<string, unknown> = {}) =>
    service.verificarAssercao({ assertion, audience: "PCTEC_HELPDESK", consumer: "PCTEC_HELPDESK", ...ACAO, ...extra });

  it("válida uma vez; a segunda é ALREADY_USED", async () => {
    const { service, p } = cenario();
    const { assertion } = await service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO });
    expect(await verificar(service, assertion)).toMatchObject({
      status: "VALID",
      identityPublicId: OPERADOR,
      issuerApplicationCode: "PCTEC_CENTRAL_SERVICOS"
    });
    expect(await verificar(service, assertion)).toMatchObject({ status: "ALREADY_USED" });
    expect(p.auditoria.map((a) => a.eventType)).toEqual(["delegation-assertion.issued", "delegation-assertion.consumed"]);
  });

  it("token adulterado ou desconhecido é INVALID", async () => {
    const { service } = cenario();
    const { assertion } = await service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO });
    const trocado = (assertion[0] === "A" ? "B" : "A") + assertion.slice(1);
    expect(await verificar(service, trocado)).toEqual({ status: "INVALID", reason: "UNKNOWN" });
    expect(await verificar(service, "curto")).toEqual({ status: "INVALID", reason: "UNKNOWN" });
    expect(await verificar(service, 123)).toEqual({ status: "INVALID", reason: "UNKNOWN" });
  });

  it("usada para outra ação (chamado, chave, tipo ou conteúdo) é INVALID e continua servindo à verdadeira", async () => {
    const { service } = cenario();
    const { assertion } = await service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO });
    for (const extra of [
      { ticketId: 102 },
      { idempotencyKey: "n1:outra-acao-qualquer" },
      { actionKind: "RESPOSTA_PUBLICA" },
      { contentSha256: createHash("sha256").update("texto trocado").digest("hex") }
    ]) {
      expect(await verificar(service, assertion, extra)).toEqual({ status: "INVALID", reason: "BINDING_MISMATCH" });
    }
    expect(await verificar(service, assertion)).toMatchObject({ status: "VALID" });
  });

  it("destinatário diferente é INVALID", async () => {
    const { service } = cenario();
    const { assertion } = await service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO });
    expect(await service.verificarAssercao({ assertion, audience: "PCTEC_PORTAL", consumer: "PCTEC_PORTAL", ...ACAO })).toEqual({
      status: "INVALID",
      reason: "WRONG_AUDIENCE"
    });
  });

  it("vencida é EXPIRED", async () => {
    const { service, avancar } = cenario();
    const { assertion } = await service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO });
    avancar(10 * 60_000);
    expect(await verificar(service, assertion)).toEqual({ status: "EXPIRED" });
  });

  it("perfil revogado entre a emissão e o uso é REVOKED", async () => {
    const { service, p } = cenario();
    const { assertion } = await service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO });
    p.papeis.set(OPERADOR, []);
    expect(await verificar(service, assertion)).toEqual({ status: "REVOKED" });
    // Não foi consumida: se o perfil voltar dentro da validade, ainda serve.
    p.papeis.set(OPERADOR, ["N1_OPERADOR"]);
    expect(await verificar(service, assertion)).toMatchObject({ status: "VALID" });
  });

  it("duas verificações simultâneas: uma VALID, uma ALREADY_USED", async () => {
    const { service } = cenario();
    const { assertion } = await service.emitirAssercao({ identityPublicId: OPERADOR, ...ACAO });
    const r = await Promise.all([verificar(service, assertion), verificar(service, assertion)]);
    expect(r.map((x) => x.status).sort()).toEqual(["ALREADY_USED", "VALID"]);
  });
});

describe("configuração", () => {
  it("validade fora de 60..86400 s é recusada na construção", () => {
    const p = new PersistenciaEmMemoria();
    expect(() => new CentralServicosService({ persistencia: p, validadeAssercaoSegundos: 30 })).toThrow();
    expect(() => new CentralServicosService({ persistencia: p, validadeAssercaoSegundos: 100_000 })).toThrow();
  });
});
