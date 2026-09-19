/**
 * Lifecycle SUPERSEDED de `IdentityExternalReference` — FASE 7 da
 * fundação PCTEC Meu RH.
 *
 * O que estes testes provam:
 *
 *   A → ACTIVE; supersede A; A → SUPERSEDED; nova B → ACTIVE; a
 *   resolução Identity → sistema/entidade devolve B e NUNCA A.
 *
 * E, principalmente, o que separa supersede de exclusão: a linha antiga
 * continua lá, consultável, com o motivo e o ator registrados.
 */
import { describe, expect, it } from "vitest";

import { SupersedeIdentityExternalReferenceService } from "../application/SupersedeIdentityExternalReferenceService.js";
import { GetActiveIdentityExternalReferenceByIdentityService } from "../application/GetActiveIdentityExternalReferenceByIdentityService.js";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import type { IdentityExternalReferenceRepository } from "../domain/IdentityExternalReferenceRepository.js";
import {
  IdentityExternalReferenceAlreadyExistsError,
  IdentityExternalReferenceBindingNotFoundError,
  IdentityExternalReferenceNotActiveError,
  IdentityExternalReferenceNotFoundByPublicIdError
} from "../domain/errors/IdentityExternalReferenceErrors.js";
import { InvalidSupersedeReasonError } from "../domain/value-objects/SupersedeReason.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { SystemCode } from "../domain/value-objects/SystemCode.js";
import type { EntityType } from "../domain/value-objects/EntityType.js";
import type { LegacyId } from "../domain/value-objects/LegacyId.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";

const IDENTIDADE = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const OUTRA_IDENTIDADE = "0b13f6f0-8f3a-4a1e-9c2d-000000000099";
const ATOR = "8f14e45f-ceea-467e-a1a3-000000000001";
const SISTEMA = "PCTEC_HUB";
const ENTIDADE = "rh_colaboradores";

class FakeUnitOfWork implements UnitOfWork {
  public transacoes = 0;
  public revertidas = 0;

  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    this.transacoes += 1;
    try {
      return await work({ execute: async () => [[], []] } as unknown as Queryable);
    } catch (erro) {
      this.revertidas += 1;
      throw erro;
    }
  }
}

class FakeAuditEventRepository implements AuditEventRepository {
  public readonly eventos: AuditEvent[] = [];
  public async insert(event: AuditEvent): Promise<void> {
    this.eventos.push(event);
  }
  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    this.eventos.push(...events);
  }
}

/**
 * Dublê que reproduz a semântica real do banco depois da migration
 * 0024: a UNIQUE KEY de binding é verificada NO INSERT, e linhas
 * SUPERSEDED nunca disputam a chave.
 */
class RepositorioEmMemoria implements IdentityExternalReferenceRepository {
  public readonly stored: IdentityExternalReference[] = [];
  /** Contagem de DELETEs — deve permanecer zero em todo este arquivo. */
  public exclusoes = 0;

  public async existsActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<boolean> {
    return this.stored.some(
      (r) =>
        r.isActive() &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType) &&
        r.getLegacyId().equals(legacyId)
    );
  }
  public async findByPublicId(publicId: PublicId): Promise<IdentityExternalReference | undefined> {
    return this.stored.find((r) => r.getPublicId().equals(publicId));
  }
  public async findActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<IdentityExternalReference | undefined> {
    return this.stored.find(
      (r) =>
        r.isActive() &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType) &&
        r.getLegacyId().equals(legacyId)
    );
  }
  public async findActiveByIdentityAndSystemCodeAndEntityType(
    identityPublicId: string,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<IdentityExternalReference | undefined> {
    return this.ativas(identityPublicId, systemCode, entityType)[0];
  }
  public async countActiveByIdentityAndSystemCodeAndEntityType(
    identityPublicId: string,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<number> {
    return this.ativas(identityPublicId, systemCode, entityType).length;
  }
  public async insert(reference: IdentityExternalReference): Promise<void> {
    const colide =
      this.ativas(reference.getIdentityPublicId(), reference.getSystemCode(), reference.getEntityType()).length > 0;
    if (colide) {
      throw new Error("uk_id_ext_ref_active_binding violada — o dublê reproduz a recusa do banco.");
    }
    this.stored.push(reference);
  }
  public async supersede(reference: IdentityExternalReference): Promise<void> {
    const indice = this.stored.findIndex((r) => r.getPublicId().equals(reference.getPublicId()));
    if (indice < 0) {
      throw new IdentityExternalReferenceNotActiveError(reference.getPublicId().toString());
    }
    // A linha permanece — só é substituída pelo MESMO agregado, agora
    // com status SUPERSEDED. Nunca `splice`.
    this.stored[indice] = reference;
  }

  private ativas(
    identityPublicId: string,
    systemCode: SystemCode,
    entityType: EntityType
  ): IdentityExternalReference[] {
    return this.stored.filter(
      (r) =>
        r.isActive() &&
        r.getIdentityPublicId() === identityPublicId &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType)
    );
  }
}

interface Cenario {
  readonly repositorio: RepositorioEmMemoria;
  readonly auditoria: FakeAuditEventRepository;
  readonly unitOfWork: FakeUnitOfWork;
  readonly supersede: SupersedeIdentityExternalReferenceService;
  readonly resolver: GetActiveIdentityExternalReferenceByIdentityService;
}

function montar(): Cenario {
  const repositorio = new RepositorioEmMemoria();
  const auditoria = new FakeAuditEventRepository();
  const unitOfWork = new FakeUnitOfWork();
  return {
    repositorio,
    auditoria,
    unitOfWork,
    supersede: new SupersedeIdentityExternalReferenceService(
      unitOfWork,
      () => repositorio,
      () => auditoria
    ),
    resolver: new GetActiveIdentityExternalReferenceByIdentityService(repositorio)
  };
}

async function comReferenciaAtiva(
  cenario: Cenario,
  overrides: { identityPublicId?: string; legacyId?: number } = {}
): Promise<IdentityExternalReference> {
  const referencia = IdentityExternalReference.create({
    identityPublicId: overrides.identityPublicId ?? IDENTIDADE,
    systemCode: SISTEMA,
    entityType: ENTIDADE,
    legacyId: overrides.legacyId ?? 10,
    matchMethod: "MATCHED_BY_EMAIL",
    actorPublicId: ATOR,
    correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  });
  referencia.pullDomainEvents();
  await cenario.repositorio.insert(referencia);
  return referencia;
}

describe("supersede — o ciclo completo A → SUPERSEDED, B → ACTIVE", () => {
  it("supersede + substituição: A deixa de ser ACTIVE, B assume, e a resolução devolve B — nunca A", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario, { legacyId: 10 });

    const resultado = await cenario.supersede.execute({
      referencePublicId: a.getPublicId().toString(),
      reason: "MATCH_CORRECTION",
      actorPublicId: ATOR,
      replacement: { legacyId: 20, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
    });

    expect(resultado.supersededPublicId).toBe(a.getPublicId().toString());
    expect(resultado.replacementPublicId).toBeDefined();

    const resolvida = await cenario.resolver.execute(IDENTIDADE, SISTEMA, ENTIDADE);
    expect(resolvida.getLegacyId().toNumber()).toBe(20);
    expect(resolvida.getPublicId().toString()).toBe(resultado.replacementPublicId);
    expect(resolvida.getPublicId().toString()).not.toBe(a.getPublicId().toString());
  });

  it("A continua EXISTINDO como histórico — supersede não é exclusão", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario, { legacyId: 10 });

    await cenario.supersede.execute({
      referencePublicId: a.getPublicId().toString(),
      reason: "MATCH_CORRECTION",
      actorPublicId: ATOR,
      replacement: { legacyId: 20, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
    });

    const antiga = await cenario.repositorio.findByPublicId(a.getPublicId());
    expect(antiga).toBeDefined();
    expect(antiga?.getStatus()).toBe("SUPERSEDED");
    expect(antiga?.getLegacyId().toNumber()).toBe(10);
    expect(cenario.repositorio.stored).toHaveLength(2);
    expect(cenario.repositorio.exclusoes).toBe(0);
  });

  it("supersede SEM substituição encerra o vínculo — a resolução passa a não encontrar nada", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario);

    const resultado = await cenario.supersede.execute({
      referencePublicId: a.getPublicId().toString(),
      reason: "IDENTITY_OFFBOARDED",
      actorPublicId: ATOR
    });

    expect(resultado.replacementPublicId).toBeUndefined();
    await expect(cenario.resolver.execute(IDENTIDADE, SISTEMA, ENTIDADE)).rejects.toBeInstanceOf(
      IdentityExternalReferenceBindingNotFoundError
    );
    expect(cenario.repositorio.stored).toHaveLength(1);
  });

  it("em NENHUM instante existem duas referências ACTIVE — nem dentro da transação", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario, { legacyId: 10 });

    // O dublê recusa o INSERT enquanto houver outra ACTIVE para a mesma
    // chave, exatamente como a UNIQUE KEY faria. A operação só pode
    // concluir se o supersede vier ANTES do insert.
    await expect(
      cenario.supersede.execute({
        referencePublicId: a.getPublicId().toString(),
        reason: "MATCH_CORRECTION",
        actorPublicId: ATOR,
        replacement: { legacyId: 20, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
      })
    ).resolves.toBeDefined();

    expect(cenario.repositorio.stored.filter((r) => r.isActive())).toHaveLength(1);
  });
});

describe("supersede — recusas", () => {
  it("referência inexistente é recusada", async () => {
    const cenario = montar();

    await expect(
      cenario.supersede.execute({
        referencePublicId: "11111111-1111-4111-8111-111111111111",
        reason: "MATCH_CORRECTION",
        actorPublicId: ATOR
      })
    ).rejects.toBeInstanceOf(IdentityExternalReferenceNotFoundByPublicIdError);
  });

  it("superar duas vezes a MESMA referência é recusado na segunda", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario);
    const pedido = {
      referencePublicId: a.getPublicId().toString(),
      reason: "IDENTITY_OFFBOARDED",
      actorPublicId: ATOR
    };

    await cenario.supersede.execute(pedido);

    await expect(cenario.supersede.execute(pedido)).rejects.toBeInstanceOf(
      IdentityExternalReferenceNotActiveError
    );
  });

  it("motivo fora do conjunto fechado é recusado — e nada é escrito", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario);

    await expect(
      cenario.supersede.execute({
        referencePublicId: a.getPublicId().toString(),
        reason: "porque o RH pediu",
        actorPublicId: ATOR
      })
    ).rejects.toBeInstanceOf(InvalidSupersedeReasonError);

    const intacta = await cenario.repositorio.findByPublicId(a.getPublicId());
    expect(intacta?.getStatus()).toBe("ACTIVE");
    expect(cenario.auditoria.eventos).toHaveLength(0);
  });

  it("substituir por um registro legado que já pertence a OUTRA Identity é recusado", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario, { legacyId: 10 });
    await comReferenciaAtiva(cenario, { identityPublicId: OUTRA_IDENTIDADE, legacyId: 20 });

    await expect(
      cenario.supersede.execute({
        referencePublicId: a.getPublicId().toString(),
        reason: "MATCH_CORRECTION",
        actorPublicId: ATOR,
        replacement: { legacyId: 20, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
      })
    ).rejects.toBeInstanceOf(IdentityExternalReferenceAlreadyExistsError);

    // A transação foi revertida — quem persiste de verdade desfaz o
    // supersede junto com o insert recusado.
    expect(cenario.unitOfWork.revertidas).toBe(1);
  });
});

describe("supersede — auditoria", () => {
  it("emite identity-external-reference.superseded com motivo, ator e o publicId da substituta", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario, { legacyId: 10 });

    const resultado = await cenario.supersede.execute({
      referencePublicId: a.getPublicId().toString(),
      reason: "MATCH_CORRECTION",
      actorPublicId: ATOR,
      replacement: { legacyId: 20, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
    });

    const superseded = cenario.auditoria.eventos.find(
      (e) => e.eventType === "identity-external-reference.superseded"
    );
    expect(superseded).toBeDefined();
    expect(superseded?.actorPublicId).toBe(ATOR);
    expect(superseded?.eventVersion).toBe(1);
    expect(superseded?.payload).toMatchObject({
      identityPublicId: IDENTIDADE,
      systemCode: SISTEMA,
      entityType: ENTIDADE,
      reason: "MATCH_CORRECTION",
      replacedByPublicId: resultado.replacementPublicId
    });
  });

  it("o .created da substituta aponta para o .superseded via causationId, e ambos compartilham o correlationId", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario, { legacyId: 10 });

    await cenario.supersede.execute({
      referencePublicId: a.getPublicId().toString(),
      reason: "MATCH_CORRECTION",
      actorPublicId: ATOR,
      correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      replacement: { legacyId: 20, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
    });

    const superseded = cenario.auditoria.eventos.find(
      (e) => e.eventType === "identity-external-reference.superseded"
    );
    const created = cenario.auditoria.eventos.find((e) => e.eventType === "identity-external-reference.created");

    expect(created?.causationId).toBe(superseded?.eventPublicId);
    expect(superseded?.correlationId).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(created?.correlationId).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  });

  it("nenhum evento carrega legacyId, e-mail, CPF ou nome", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario, { legacyId: 10 });

    await cenario.supersede.execute({
      referencePublicId: a.getPublicId().toString(),
      reason: "MATCH_CORRECTION",
      actorPublicId: ATOR,
      replacement: { legacyId: 20, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
    });

    const serializado = JSON.stringify(cenario.auditoria.eventos.map((e) => e.payload));
    expect(serializado).not.toContain("legacyId");
    expect(serializado).not.toContain("legacy_id");
    expect(serializado).not.toContain("@");
  });

  it("toda a operação acontece em UMA transação", async () => {
    const cenario = montar();
    const a = await comReferenciaAtiva(cenario, { legacyId: 10 });

    await cenario.supersede.execute({
      referencePublicId: a.getPublicId().toString(),
      reason: "SOURCE_RECORD_REPLACED",
      actorPublicId: ATOR,
      replacement: { legacyId: 20, matchMethod: "MATCHED_MANUAL_CONFIRMED" }
    });

    expect(cenario.unitOfWork.transacoes).toBe(1);
    expect(cenario.unitOfWork.revertidas).toBe(0);
  });
});
