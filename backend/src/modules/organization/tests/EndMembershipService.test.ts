import { describe, it, expect } from "vitest";
import { EndMembershipService } from "../application/EndMembershipService.js";
import { GetPortalContextService } from "../../portal/application/GetPortalContextService.js";
import { Membership, type MembershipPersistedState } from "../domain/Membership.js";
import { Organization } from "../domain/Organization.js";
import { OrganizationRelationship } from "../domain/OrganizationRelationship.js";
import {
  MembershipAlreadyEndedError,
  MembershipNotFoundError,
  MembershipVersionConflictError,
  InvalidMembershipEndReasonError
} from "../domain/errors/MembershipErrors.js";
import type { MembershipRepository } from "../domain/MembershipRepository.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { OrganizationRelationshipRepository } from "../domain/OrganizationRelationshipRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { MembershipProfile } from "../domain/value-objects/MembershipProfile.js";
import type { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";

/**
 * Testes do comando EndMembership — P1D.1.
 *
 * A operação de revogação de vínculo que faltava no módulo. O que estes
 * testes precisam provar, além do caminho feliz:
 *   1. encerrar REMOVE a organização do `PortalContext` — que é o efeito
 *      pelo qual a operação existe;
 *   2. encerrar NÃO apaga a linha, e o histórico continua consultável;
 *   3. a trilha de auditoria registra a transição e o motivo;
 *   4. dupla revogação falha em vez de virar no-op silencioso;
 *   5. concorrência é detectada, nunca sobrescrita.
 *
 * Fakes 100% em memória — nenhum toca SQL, mysql2 ou o ambiente DEV.
 */

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ACTOR_PUBLIC_ID = "11111111-2222-4333-8444-555555555555";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

/**
 * Fake que RECONSTITUI a cada leitura, como o repositório MariaDB faz.
 *
 * Guardar a instância viva e devolvê-la seria um fake enganoso: mutar o
 * Aggregate já alteraria o "banco", e o optimistic locking pareceria
 * quebrado (ou, pior, pareceria funcionar em cenários onde não
 * funcionaria de verdade). Aqui o estado é serializado no `insert`/
 * `update` e uma instância nova sai de cada `find`, exatamente como um
 * `SELECT` produz.
 */
class InMemoryMembershipRepository implements MembershipRepository {
  private readonly linhas: MembershipPersistedState[] = [];
  private proximoInternalId = 1;
  /** Versões exigidas em cada `update` — prova do optimistic locking. */
  public readonly updateCalls: Array<{ publicId: string; expectedVersion: number }> = [];

  private static paraEstado(membership: Membership, internalId: number): MembershipPersistedState {
    return {
      internalId,
      publicId: membership.getPublicId().toString(),
      identityPublicId: membership.getIdentityPublicId(),
      organizationPublicId: membership.getOrganizationPublicId(),
      profile: membership.getProfile().toString(),
      scope: membership.getScope().toString(),
      status: membership.getStatus(),
      startedAt: membership.getStartedAt(),
      endedAt: membership.getEndedAt(),
      version: membership.getVersion(),
      createdAt: membership.getCreatedAt(),
      updatedAt: membership.getUpdatedAt()
    };
  }

  public async existsByIdentityOrganizationAndProfile(
    identityPublicId: string,
    organizationPublicId: string,
    profile: MembershipProfile
  ): Promise<boolean> {
    return this.linhas.some(
      (l) =>
        l.identityPublicId === identityPublicId &&
        l.organizationPublicId === organizationPublicId &&
        l.profile === profile.toString()
    );
  }
  public async findAllByIdentityPublicId(identityPublicId: string): Promise<Membership[]> {
    return this.linhas.filter((l) => l.identityPublicId === identityPublicId).map(Membership.reconstitute);
  }
  public async findActiveByIdentityPublicId(identityPublicId: string): Promise<Membership[]> {
    return this.linhas
      .filter((l) => l.identityPublicId === identityPublicId && l.status === "ACTIVE")
      .map(Membership.reconstitute);
  }
  public async findByPublicId(publicId: PublicId): Promise<Membership | undefined> {
    const linha = this.linhas.find((l) => l.publicId === publicId.toString());
    return linha === undefined ? undefined : Membership.reconstitute(linha);
  }
  public async update(membership: Membership, expectedVersion: number): Promise<void> {
    this.updateCalls.push({ publicId: membership.getPublicId().toString(), expectedVersion });
    const indice = this.linhas.findIndex((l) => l.publicId === membership.getPublicId().toString());
    // Mesma condição do `UPDATE ... WHERE public_id = ? AND version = ?`.
    if (indice === -1 || this.linhas[indice]!.version !== expectedVersion) {
      throw new MembershipVersionConflictError(expectedVersion, membership.getVersion());
    }
    this.linhas[indice] = InMemoryMembershipRepository.paraEstado(membership, this.linhas[indice]!.internalId);
  }
  public async insert(membership: Membership): Promise<void> {
    this.linhas.push(InMemoryMembershipRepository.paraEstado(membership, this.proximoInternalId));
    membership.assignInternalIdFromPersistence(this.proximoInternalId);
    this.proximoInternalId += 1;
  }
}

class InMemoryOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();
  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }
  public async existsByDocumentNumberAndType(_d: DocumentNumber, _t: OrganizationType): Promise<boolean> {
    return false;
  }
  public async insert(organization: Organization): Promise<void> {
    this.stored.set(organization.getPublicId().toString(), organization);
  }
}

class InMemoryOrganizationRelationshipRepository implements OrganizationRelationshipRepository {
  public readonly stored: OrganizationRelationship[] = [];
  public async existsByChildOrganizationPublicId(childOrganizationPublicId: PublicId): Promise<boolean> {
    return this.stored.some((r) => r.getChildOrganizationPublicId().equals(childOrganizationPublicId));
  }
  public async findChildrenByParentPublicId(parentPublicId: PublicId): Promise<OrganizationRelationship[]> {
    return this.stored.filter((r) => r.getParentOrganizationPublicId().equals(parentPublicId));
  }
  public async insert(relationship: OrganizationRelationship): Promise<void> {
    this.stored.push(relationship);
  }
}

class InMemoryAuditEventRepository implements AuditEventRepository {
  public readonly stored: AuditEvent[] = [];
  public async insert(event: AuditEvent): Promise<void> {
    this.stored.push(event);
  }
  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    this.stored.push(...events);
  }
}

/** UnitOfWork em memória — executa o callback sem transação real. */
const fakeUnitOfWork: UnitOfWork = {
  runInTransaction: async <T,>(fn: (connection: Queryable) => Promise<T>): Promise<T> =>
    fn({} as unknown as Queryable)
};

function buildFixture() {
  const membershipRepository = new InMemoryMembershipRepository();
  const organizationRepository = new InMemoryOrganizationRepository();
  const relationshipRepository = new InMemoryOrganizationRelationshipRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();
  const service = new EndMembershipService(
    fakeUnitOfWork,
    () => membershipRepository,
    () => auditEventRepository
  );
  const portalContextService = new GetPortalContextService(
    membershipRepository,
    organizationRepository,
    relationshipRepository
  );
  return {
    membershipRepository,
    organizationRepository,
    relationshipRepository,
    auditEventRepository,
    service,
    portalContextService
  };
}

function criarOrganizacao(type: "BUSINESS_GROUP" | "COMPANY", legalName: string, tradeName?: string): Organization {
  return Organization.create({
    type,
    legalName,
    tradeName,
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
}

async function criarVinculo(
  fixture: ReturnType<typeof buildFixture>,
  organization: Organization,
  scope: "ORGANIZATION_ONLY" | "ORGANIZATION_AND_DESCENDANTS" = "ORGANIZATION_ONLY"
): Promise<Membership> {
  await fixture.organizationRepository.insert(organization);
  const membership = Membership.create({
    identityPublicId: IDENTITY_PUBLIC_ID,
    organizationPublicId: organization.getPublicId().toString(),
    profile: "CUSTOMER",
    scope,
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
  membership.pullDomainEvents(); // descarta o membership.created da fixture
  await fixture.membershipRepository.insert(membership);
  return membership;
}

// ---------------------------------------------------------------------------
// Efeito: sai do PortalContext
// ---------------------------------------------------------------------------

describe("EndMembershipService — efeito no PortalContext", () => {
  it("A. encerrar o vínculo remove a Organization do PortalContext efetivo", async () => {
    const fixture = buildFixture();
    const pctec = criarOrganizacao("COMPANY", "PCTEC", "PCTEC");
    const afip = criarOrganizacao("BUSINESS_GROUP", "AFIP", "AFIP");
    const vinculoPctec = await criarVinculo(fixture, pctec);
    await criarVinculo(fixture, afip, "ORGANIZATION_AND_DESCENDANTS");

    const antes = await fixture.portalContextService.execute(IDENTITY_PUBLIC_ID);
    expect(antes.organizations.map((o) => o.tradeName)).toEqual(["PCTEC", "AFIP"]);

    await fixture.service.execute({
      membershipPublicId: vinculoPctec.getPublicId().toString(),
      reason: "conta temporária de homologação — acesso restrito à AFIP",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    const depois = await fixture.portalContextService.execute(IDENTITY_PUBLIC_ID);
    expect(depois.organizations.map((o) => o.tradeName)).toEqual(["AFIP"]);
    expect(depois.organizations.some((o) => o.tradeName === "PCTEC")).toBe(false);
  });

  it("B. o vínculo do grupo e suas descendentes continuam intactos", async () => {
    const fixture = buildFixture();
    const pctec = criarOrganizacao("COMPANY", "PCTEC", "PCTEC");
    const afip = criarOrganizacao("BUSINESS_GROUP", "AFIP", "AFIP");
    const filha = criarOrganizacao("COMPANY", "AFIP BOSQUE", "AFIP - BOSQUE");
    const vinculoPctec = await criarVinculo(fixture, pctec);
    await criarVinculo(fixture, afip, "ORGANIZATION_AND_DESCENDANTS");
    await fixture.organizationRepository.insert(filha);
    await fixture.relationshipRepository.insert(
      OrganizationRelationship.create({
        parentOrganizationPublicId: afip.getPublicId().toString(),
        childOrganizationPublicId: filha.getPublicId().toString(),
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    );

    await fixture.service.execute({
      membershipPublicId: vinculoPctec.getPublicId().toString(),
      reason: "restrição de homologação",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    const depois = await fixture.portalContextService.execute(IDENTITY_PUBLIC_ID);
    expect(depois.organizations.map((o) => o.tradeName).sort()).toEqual(["AFIP", "AFIP - BOSQUE"]);
  });

  it("C. encerrar NÃO apaga a linha — o vínculo continua consultável como INACTIVE", async () => {
    const fixture = buildFixture();
    const pctec = criarOrganizacao("COMPANY", "PCTEC", "PCTEC");
    const vinculo = await criarVinculo(fixture, pctec);

    await fixture.service.execute({
      membershipPublicId: vinculo.getPublicId().toString(),
      reason: "restrição de homologação",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    const todos = await fixture.membershipRepository.findAllByIdentityPublicId(IDENTITY_PUBLIC_ID);
    const ativos = await fixture.membershipRepository.findActiveByIdentityPublicId(IDENTITY_PUBLIC_ID);
    expect(todos).toHaveLength(1);
    expect(ativos).toHaveLength(0);
    expect(todos[0]?.getStatus()).toBe("INACTIVE");
    expect(todos[0]?.getEndedAt()).toBeInstanceOf(Date);
    // A identidade do vínculo é preservada — mesma linha, nunca uma nova.
    expect(todos[0]?.getPublicId().toString()).toBe(vinculo.getPublicId().toString());
    expect(todos[0]?.getOrganizationPublicId()).toBe(pctec.getPublicId().toString());
  });
});

// ---------------------------------------------------------------------------
// Auditoria e resultado
// ---------------------------------------------------------------------------

describe("EndMembershipService — auditoria", () => {
  it("D. grava membership.updated com a transição e o motivo", async () => {
    const fixture = buildFixture();
    const pctec = criarOrganizacao("COMPANY", "PCTEC", "PCTEC");
    const vinculo = await criarVinculo(fixture, pctec);

    await fixture.service.execute({
      membershipPublicId: vinculo.getPublicId().toString(),
      reason: "conta temporária de homologação",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(fixture.auditEventRepository.stored).toHaveLength(1);
    const evento = fixture.auditEventRepository.stored[0] as unknown as {
      eventType: string;
      payload: Record<string, unknown>;
      actorPublicId: string;
    };
    const bruto = JSON.stringify(fixture.auditEventRepository.stored[0]);
    expect(bruto).toContain("membership.updated");
    expect(bruto).toContain("conta temporária de homologação");
    expect(bruto).toContain("ACTIVE");
    expect(bruto).toContain("INACTIVE");
    expect(evento.actorPublicId ?? bruto).toBeTruthy();
    // O ator registrado é quem operou, nunca a Identity beneficiada.
    expect(bruto).toContain(ACTOR_PUBLIC_ID);
  });

  it("E. resultado descreve a transição sem expor nada além do vínculo", async () => {
    const fixture = buildFixture();
    const pctec = criarOrganizacao("COMPANY", "PCTEC", "PCTEC");
    const vinculo = await criarVinculo(fixture, pctec);

    const resultado = await fixture.service.execute({
      membershipPublicId: vinculo.getPublicId().toString(),
      reason: "restrição de homologação",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(resultado.previousStatus).toBe("ACTIVE");
    expect(resultado.status).toBe("INACTIVE");
    expect(resultado.endedAt).not.toBe("");
    expect(Object.keys(resultado).sort()).toEqual([
      "endedAt",
      "identityPublicId",
      "organizationPublicId",
      "previousStatus",
      "profile",
      "publicId",
      "scope",
      "status"
    ]);
  });
});

// ---------------------------------------------------------------------------
// Falhas
// ---------------------------------------------------------------------------

describe("EndMembershipService — falhas", () => {
  it("F. Membership inexistente → MEMBERSHIP_NOT_FOUND, nada auditado", async () => {
    const fixture = buildFixture();
    const inexistente = criarOrganizacao("COMPANY", "QUALQUER");

    await expect(
      fixture.service.execute({
        membershipPublicId: inexistente.getPublicId().toString(),
        reason: "x",
        actorPublicId: ACTOR_PUBLIC_ID
      })
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
    expect(fixture.auditEventRepository.stored).toHaveLength(0);
  });

  it("G. encerrar duas vezes → MEMBERSHIP_ALREADY_ENDED, nunca no-op silencioso", async () => {
    const fixture = buildFixture();
    const pctec = criarOrganizacao("COMPANY", "PCTEC", "PCTEC");
    const vinculo = await criarVinculo(fixture, pctec);
    const pedido = {
      membershipPublicId: vinculo.getPublicId().toString(),
      reason: "restrição de homologação",
      actorPublicId: ACTOR_PUBLIC_ID
    };

    await fixture.service.execute(pedido);
    // O operador que roda de novo precisa saber que a segunda não fez
    // nada — senão "revoguei o errado" passa despercebido.
    await expect(fixture.service.execute(pedido)).rejects.toBeInstanceOf(MembershipAlreadyEndedError);
    expect(fixture.auditEventRepository.stored).toHaveLength(1);
  });

  it("H. motivo vazio ou só espaços → MEMBERSHIP_END_REASON_INVALID, vínculo intacto", async () => {
    const fixture = buildFixture();
    const pctec = criarOrganizacao("COMPANY", "PCTEC", "PCTEC");
    const vinculo = await criarVinculo(fixture, pctec);

    for (const reason of ["", "   ", "\t\n"]) {
      await expect(
        fixture.service.execute({
          membershipPublicId: vinculo.getPublicId().toString(),
          reason,
          actorPublicId: ACTOR_PUBLIC_ID
        })
      ).rejects.toBeInstanceOf(InvalidMembershipEndReasonError);
    }
    const ativos = await fixture.membershipRepository.findActiveByIdentityPublicId(IDENTITY_PUBLIC_ID);
    expect(ativos).toHaveLength(1);
    expect(fixture.auditEventRepository.stored).toHaveLength(0);
  });

  it("I. optimistic locking: o update é condicionado à versão lida antes da mutação", async () => {
    const fixture = buildFixture();
    const pctec = criarOrganizacao("COMPANY", "PCTEC", "PCTEC");
    const vinculo = await criarVinculo(fixture, pctec);
    const versaoInicial = vinculo.getVersion();

    await fixture.service.execute({
      membershipPublicId: vinculo.getPublicId().toString(),
      reason: "restrição de homologação",
      actorPublicId: ACTOR_PUBLIC_ID
    });

    expect(fixture.membershipRepository.updateCalls).toEqual([
      { publicId: vinculo.getPublicId().toString(), expectedVersion: versaoInicial }
    ]);
    // E a versão avançou, como a migration previa.
    const [persistido] = await fixture.membershipRepository.findAllByIdentityPublicId(IDENTITY_PUBLIC_ID);
    expect(persistido?.getVersion()).toBe(versaoInicial + 1);
  });
});

// ---------------------------------------------------------------------------
// Boundary
// ---------------------------------------------------------------------------

describe("EndMembershipService — boundary", () => {
  it("J. nunca toca ApplicationAccess, Organization ou referências externas", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const fonte = readFileSync(
      fileURLToPath(new URL("../application/EndMembershipService.ts", import.meta.url)),
      "utf-8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    expect(fonte).not.toContain("ApplicationAccess");
    expect(fonte).not.toContain("OrganizationExternalReference");
    expect(fonte).not.toContain("OrganizationRelationship");
    expect(fonte).not.toContain("IdentityRepository");
    // Só Membership + auditoria.
    expect(fonte).toContain("MembershipRepository");
    expect(fonte).toContain("AuditEventRepository");
  });
});
