import { describe, expect, it } from "vitest";
import { RenameOrganizationService } from "../application/RenameOrganizationService.js";
import { Organization } from "../domain/Organization.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { OrganizationNotFoundError, OrganizationVersionConflictError } from "../domain/errors/OrganizationErrors.js";

const ORG = "33333333-3333-4333-8333-333333333333";
const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const AGORA = new Date("2026-01-01T12:00:00.000Z");

class FakeUnitOfWork implements UnitOfWork {
  public async runInTransaction<T>(work: (c: Queryable) => Promise<T>): Promise<T> {
    return work({ execute: async () => [[], []] });
  }
}

class FakeAuditEventRepository implements AuditEventRepository {
  public readonly eventos: AuditEvent[] = [];
  public async insert(e: AuditEvent): Promise<void> { this.eventos.push(e); }
  public async insertMany(e: readonly AuditEvent[]): Promise<void> { this.eventos.push(...e); }
}

function organizacao(legalName = "RAZAO ANTIGA LTDA", tradeName: string | undefined = "Fantasia Antiga", version = 4): Organization {
  return Organization.reconstitute({
    internalId: 1, publicId: ORG, type: "COMPANY",
    legalName, tradeName, status: "ACTIVE", version, createdAt: AGORA, updatedAt: AGORA
  });
}

class FakeOrganizationRepository implements OrganizationRepository {
  public atualizacoes: Array<{ legalName: string; tradeName: string | null; expectedVersion: number }> = [];
  public constructor(private readonly encontrada: Organization | undefined) {}
  public async findByPublicId(): Promise<Organization | undefined> { return this.encontrada; }
  public async existsByDocumentNumberAndType(): Promise<boolean> { return false; }
  public async insert(): Promise<void> {}
  public async update(o: Organization, expectedVersion: number): Promise<void> {
    this.atualizacoes.push({
      legalName: o.getLegalName().toString(),
      tradeName: o.getTradeName()?.toString() ?? null,
      expectedVersion
    });
  }
}

function montar(alvo: Organization | null = organizacao()) {
  // `null` significa "não existe" — `undefined` cairia no default do
  // parâmetro e devolveria uma organização real.
  const repositorio = new FakeOrganizationRepository(alvo ?? undefined);
  const auditoria = new FakeAuditEventRepository();
  return {
    repositorio, auditoria,
    service: new RenameOrganizationService(new FakeUnitOfWork(), () => repositorio, () => auditoria)
  };
}

const BASE = { organizationPublicId: ORG, actorPublicId: ADMIN, expectedVersion: 4 };

describe("correção de nomes da organização", () => {
  it("corrige razão social e nome fantasia", async () => {
    const c = montar();
    const r = await c.service.execute({ ...BASE, legalName: "RAZAO NOVA LTDA", tradeName: "Fantasia Nova" });

    expect(r).toMatchObject({ legalName: "RAZAO NOVA LTDA", tradeName: "Fantasia Nova", changed: true, version: 5 });
    expect([...r.changedFields].sort()).toEqual(["legalName", "tradeName"]);
  });

  it("tradeName AUSENTE mantém o nome fantasia — não apaga por omissão", async () => {
    const c = montar();
    const r = await c.service.execute({ ...BASE, legalName: "RAZAO NOVA LTDA" });

    expect(r.tradeName).toBe("Fantasia Antiga");
    expect(r.changedFields).toEqual(["legalName"]);
  });

  it("tradeName vazio LIMPA o nome fantasia", async () => {
    const c = montar();
    const r = await c.service.execute({ ...BASE, legalName: "RAZAO ANTIGA LTDA", tradeName: "" });

    expect(r.tradeName).toBeNull();
    expect(r.changedFields).toEqual(["tradeName"]);
  });

  it("sem mudança real, NÃO escreve e não gasta versão", async () => {
    const c = montar();
    const r = await c.service.execute({ ...BASE, legalName: "RAZAO ANTIGA LTDA", tradeName: "Fantasia Antiga" });

    expect(r.changed).toBe(false);
    expect(r.version).toBe(4);
    expect(c.repositorio.atualizacoes).toHaveLength(0);
    expect(c.auditoria.eventos).toHaveLength(0);
  });

  it("persiste com a versão ANTERIOR na trava otimista", async () => {
    const c = montar();
    await c.service.execute({ ...BASE, legalName: "RAZAO NOVA LTDA" });

    expect(c.repositorio.atualizacoes).toEqual([
      { legalName: "RAZAO NOVA LTDA", tradeName: "Fantasia Antiga", expectedVersion: 4 }
    ]);
  });

  it("versão desatualizada na tela vira conflito", async () => {
    const c = montar();
    await expect(c.service.execute({ ...BASE, expectedVersion: 2, legalName: "OUTRA" }))
      .rejects.toBeInstanceOf(OrganizationVersionConflictError);
  });

  it("organização inexistente é recusada", async () => {
    const c = montar(null);
    await expect(c.service.execute({ ...BASE, legalName: "OUTRA" }))
      .rejects.toBeInstanceOf(OrganizationNotFoundError);
  });

  it("audita valores anterior e novo, com o ADMIN como ator", async () => {
    const c = montar();
    await c.service.execute({ ...BASE, legalName: "RAZAO NOVA LTDA", tradeName: "" });

    const evento = c.auditoria.eventos[0];
    expect(evento?.eventType).toBe("organization.renamed");
    expect(evento?.actorPublicId).toBe(ADMIN);
    expect(evento?.payload).toMatchObject({
      previousLegalName: "RAZAO ANTIGA LTDA", legalName: "RAZAO NOVA LTDA",
      previousTradeName: "Fantasia Antiga", tradeName: null
    });
  });

  it("a auditoria não carrega documento, tipo nem identificador interno", async () => {
    const c = montar();
    await c.service.execute({ ...BASE, legalName: "RAZAO NOVA LTDA" });

    const payload = JSON.stringify(c.auditoria.eventos[0]?.payload);
    expect(payload).not.toContain("documentNumber");
    expect(payload).not.toContain("COMPANY");
    expect(payload).not.toContain("internalId");
  });

  it("nunca altera tipo, documento ou status — só nomes chegam ao UPDATE", async () => {
    const c = montar();
    await c.service.execute({ ...BASE, legalName: "RAZAO NOVA LTDA" });

    expect(Object.keys(c.repositorio.atualizacoes[0] ?? {}).sort()).toEqual(["expectedVersion", "legalName", "tradeName"]);
  });

  it("razão social inválida é recusada pelo Value Object", async () => {
    const c = montar();
    await expect(c.service.execute({ ...BASE, legalName: "  " })).rejects.toThrow();
    expect(c.repositorio.atualizacoes).toHaveLength(0);
  });
});

describe("PublicId da organização", () => {
  it("publicId malformado é recusado antes de qualquer repositório", async () => {
    const c = montar();
    await expect(c.service.execute({ ...BASE, organizationPublicId: "nao-e-uuid", legalName: "X LTDA" }))
      .rejects.toThrow();
    void PublicId;
  });
});
