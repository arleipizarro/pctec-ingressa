import { describe, it, expect } from "vitest";
import { Membership } from "../domain/Membership.js";
import { InvalidMembershipProfileError } from "../domain/value-objects/MembershipProfile.js";
import { InvalidMembershipScopeError } from "../domain/value-objects/MembershipScope.js";
import {
  MembershipAlreadyEndedError,
  InvalidMembershipEndReasonError
} from "../domain/errors/MembershipErrors.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

function createValidMembership(overrides?: { profile?: string; scope?: string }) {
  return Membership.create({
    identityPublicId: IDENTITY_PUBLIC_ID,
    organizationPublicId: ORGANIZATION_PUBLIC_ID,
    profile: overrides?.profile ?? "CUSTOMER",
    scope: overrides?.scope ?? "ORGANIZATION_ONLY",
    actorPublicId: ACTOR_PUBLIC_ID,
    correlationId: CORRELATION_ID
  });
}

describe("Membership — 1. Identity válida + Organization válida (construção do Aggregate)", () => {
  it("cria um Membership com status ACTIVE, version 1, startedAt preenchido e endedAt undefined", () => {
    const membership = createValidMembership();

    expect(membership.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
    expect(membership.getOrganizationPublicId()).toBe(ORGANIZATION_PUBLIC_ID);
    expect(membership.getStatus()).toBe("ACTIVE");
    expect(membership.isActive()).toBe(true);
    expect(membership.getEndedAt()).toBeUndefined();
    expect(membership.getVersion()).toBe(1);
    expect(membership.getPublicId().toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

describe("Membership — 2. profile válido (5 valores reconfirmados contra o design)", () => {
  it.each(["EMPLOYEE", "CUSTOMER", "PARTNER", "SUPPLIER", "SERVICE_ACCOUNT"])(
    "aceita profile=%s",
    (profile) => {
      const membership = createValidMembership({ profile });
      expect(membership.getProfile().toString()).toBe(profile);
    }
  );

  it("rejeita profile fora do conjunto fechado", () => {
    expect(() => createValidMembership({ profile: "ADMIN" })).toThrow(InvalidMembershipProfileError);
  });
});

describe("Membership — 3. scope válido (nomes completos, sem abreviação)", () => {
  it.each(["ORGANIZATION_ONLY", "ORGANIZATION_AND_DESCENDANTS"])("aceita scope=%s", (scope) => {
    const membership = createValidMembership({ scope });
    expect(membership.getScope().toString()).toBe(scope);
  });

  it("rejeita scope abreviado ou fora do conjunto fechado", () => {
    expect(() => createValidMembership({ scope: "AND_DESCENDANTS" })).toThrow(InvalidMembershipScopeError);
  });

  it("includesDescendants() reflete o scope corretamente", () => {
    const onlyMembership = createValidMembership({ scope: "ORGANIZATION_ONLY" });
    const descendantsMembership = createValidMembership({ scope: "ORGANIZATION_AND_DESCENDANTS" });

    expect(onlyMembership.getScope().includesDescendants()).toBe(false);
    expect(descendantsMembership.getScope().includesDescendants()).toBe(true);
  });
});

describe("Membership — 4. múltiplos Memberships para a mesma Identity (cardinalidade, construção)", () => {
  it("duas instâncias distintas para a mesma Identity, Organizations diferentes, publicIds distintos", () => {
    const membershipA = Membership.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const membershipB = Membership.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000002",
      profile: "PARTNER",
      scope: "ORGANIZATION_AND_DESCENDANTS",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(membershipA.getIdentityPublicId()).toBe(membershipB.getIdentityPublicId());
    expect(membershipA.getOrganizationPublicId()).not.toBe(membershipB.getOrganizationPublicId());
    expect(membershipA.getPublicId().equals(membershipB.getPublicId())).toBe(false);
  });
});

describe("Membership — 5. reconstituição", () => {
  it("reconstrói um Membership a partir de estado persistido, incluindo endedAt presente (vínculo já encerrado)", () => {
    const membership = Membership.reconstitute({
      internalId: 9,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000003",
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      profile: "EMPLOYEE",
      scope: "ORGANIZATION_ONLY",
      status: "INACTIVE",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      endedAt: new Date("2026-02-01T00:00:00Z"),
      version: 2,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-02-01T00:00:00Z")
    });

    expect(membership.getInternalIdForPersistence()).toBe(9);
    expect(membership.getStatus()).toBe("INACTIVE");
    expect(membership.isActive()).toBe(false);
    expect(membership.getEndedAt()).toEqual(new Date("2026-02-01T00:00:00Z"));
    expect(membership.pullDomainEvents()).toHaveLength(0);
  });
});

describe("Membership — 6. superfície de mutação (G2 + P1D.1)", () => {
  it("create() continua produzindo version=1 e status ACTIVE — nenhuma mutação implícita", () => {
    const membership = createValidMembership();

    expect(membership.getVersion()).toBe(1);
    expect(membership.getStatus()).toBe("ACTIVE");
    expect(membership.getEndedAt()).toBeUndefined();
  });

  it("end() é o ÚNICO comando de mutação — revoke()/reactivate()/update() continuam fora de escopo", () => {
    // G2 não tinha nenhum; P1D.1 acrescentou exatamente um, o
    // encerramento que a decisão de lifecycle já havia fechado.
    // `reactivate()` segue fora: não há caso de uso real, e um comando
    // sem caso de uso é desenho especulativo.
    const membership = createValidMembership();

    expect(typeof (membership as unknown as { end?: unknown }).end).toBe("function");
    expect((membership as unknown as { revoke?: unknown }).revoke).toBeUndefined();
    expect((membership as unknown as { reactivate?: unknown }).reactivate).toBeUndefined();
    expect((membership as unknown as { update?: unknown }).update).toBeUndefined();
    expect((membership as unknown as { changeScope?: unknown }).changeScope).toBeUndefined();
  });
});

describe("Membership — 7. evento de domínio membership.created", () => {
  it("create() produz exatamente um evento membership.created, payload conforme o catálogo (sem profile)", () => {
    const membership = createValidMembership({ scope: "ORGANIZATION_AND_DESCENDANTS" });

    const events = membership.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("membership.created");
    expect(events[0]?.payload).toEqual({
      membershipPublicId: membership.getPublicId().toString(),
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      scope: "ORGANIZATION_AND_DESCENDANTS"
    });
  });

  it("pullDomainEvents() limpa a lista — chamada seguinte retorna vazio", () => {
    const membership = createValidMembership();

    expect(membership.pullDomainEvents()).toHaveLength(1);
    expect(membership.pullDomainEvents()).toHaveLength(0);
  });
});

describe("Membership — 8. não expõe internalId publicamente", () => {
  it("getInternalIdForPersistence é undefined antes de persistir, atribuível só via infraestrutura", () => {
    const membership = createValidMembership();

    expect(membership.getInternalIdForPersistence()).toBeUndefined();
    membership.assignInternalIdFromPersistence(15);
    expect(membership.getInternalIdForPersistence()).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Comando end() — P1D.1
// ---------------------------------------------------------------------------

describe("Membership.end()", () => {
  const ACTOR = "11111111-2222-4333-8444-555555555555";
  const CORRELATION = "8f14e45f-ceea-467e-a1a3-000000000001";

  function vinculoAtivo(): Membership {
    const m = Membership.create({
      identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      organizationPublicId: "b5c4358b-c8aa-42a8-9589-7c09c015f5fb",
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: ACTOR,
      correlationId: CORRELATION
    });
    m.pullDomainEvents();
    return m;
  }

  it("transiciona ACTIVE → INACTIVE, preenche endedAt e incrementa version", () => {
    const m = vinculoAtivo();
    const versaoAntes = m.getVersion();
    const agora = new Date("2026-08-23T12:00:00.000Z");

    m.end({ actorPublicId: ACTOR, reason: "restrição de homologação", correlationId: CORRELATION, now: agora });

    expect(m.getStatus()).toBe("INACTIVE");
    expect(m.isActive()).toBe(false);
    expect(m.getEndedAt()).toEqual(agora);
    expect(m.getVersion()).toBe(versaoAntes + 1);
    expect(m.getUpdatedAt()).toEqual(agora);
  });

  it("preserva a identidade do vínculo — mesma linha, nunca uma nova", () => {
    const m = vinculoAtivo();
    const publicId = m.getPublicId().toString();
    const identity = m.getIdentityPublicId();
    const organization = m.getOrganizationPublicId();
    const profile = m.getProfile().toString();
    const scope = m.getScope().toString();
    const startedAt = m.getStartedAt();

    m.end({ actorPublicId: ACTOR, reason: "x", correlationId: CORRELATION });

    expect(m.getPublicId().toString()).toBe(publicId);
    expect(m.getIdentityPublicId()).toBe(identity);
    expect(m.getOrganizationPublicId()).toBe(organization);
    expect(m.getProfile().toString()).toBe(profile);
    expect(m.getScope().toString()).toBe(scope);
    expect(m.getStartedAt()).toEqual(startedAt);
  });

  it("emite membership.updated com a transição, o motivo e o ator", () => {
    const m = vinculoAtivo();
    m.end({ actorPublicId: ACTOR, reason: "  conta temporária  ", correlationId: CORRELATION });

    const eventos = m.pullDomainEvents();
    expect(eventos).toHaveLength(1);
    const evento = eventos[0]!;
    expect(evento.eventType).toBe("membership.updated");
    expect(evento.actorPublicId).toBe(ACTOR);
    expect(evento.correlationId).toBe(CORRELATION);
    const payload = evento.payload as unknown as Record<string, unknown>;
    expect(payload["previousStatus"]).toBe("ACTIVE");
    expect(payload["status"]).toBe("INACTIVE");
    // O motivo é normalizado (trim) antes de virar trilha de auditoria.
    expect(payload["reason"]).toBe("conta temporária");
    expect(typeof payload["endedAt"]).toBe("string");
  });

  it("recusa encerrar um vínculo já encerrado", () => {
    const m = vinculoAtivo();
    m.end({ actorPublicId: ACTOR, reason: "x", correlationId: CORRELATION });
    m.pullDomainEvents();

    expect(() => m.end({ actorPublicId: ACTOR, reason: "x", correlationId: CORRELATION })).toThrow(
      MembershipAlreadyEndedError
    );
    // E nada é registrado na segunda tentativa.
    expect(m.pullDomainEvents()).toHaveLength(0);
  });

  it("recusa motivo vazio e não muta o Aggregate", () => {
    const m = vinculoAtivo();
    const versaoAntes = m.getVersion();

    for (const reason of ["", "   ", "\t\n"]) {
      expect(() => m.end({ actorPublicId: ACTOR, reason, correlationId: CORRELATION })).toThrow(
        InvalidMembershipEndReasonError
      );
    }
    expect(m.getStatus()).toBe("ACTIVE");
    expect(m.getEndedAt()).toBeUndefined();
    expect(m.getVersion()).toBe(versaoAntes);
    expect(m.pullDomainEvents()).toHaveLength(0);
  });

  it("um vínculo reconstituído como INACTIVE não pode ser encerrado de novo", () => {
    const original = vinculoAtivo();
    const inativo = Membership.reconstitute({
      internalId: 1,
      publicId: original.getPublicId().toString(),
      identityPublicId: original.getIdentityPublicId(),
      organizationPublicId: original.getOrganizationPublicId(),
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      status: "INACTIVE",
      startedAt: new Date(),
      endedAt: new Date(),
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(() => inativo.end({ actorPublicId: ACTOR, reason: "x", correlationId: CORRELATION })).toThrow(
      MembershipAlreadyEndedError
    );
  });
});
