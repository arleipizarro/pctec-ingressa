import { describe, it, expect } from "vitest";
import { OrganizationRelationship } from "../domain/OrganizationRelationship.js";
import { InvalidOrganizationPublicIdError } from "../domain/value-objects/PublicId.js";

const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";
const GROUP_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const COMPANY_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000002";

/**
 * Nota sobre o escopo destes testes: `OrganizationRelationship` (o
 * Aggregate) NÃO valida, por si só, que parent é BUSINESS_GROUP e child
 * é COMPANY — essa validação é responsabilidade do Application Service
 * (`CreateOrganizationRelationshipService`), que tem acesso às duas
 * Organizations via repository (ver nota em OrganizationRelationship.ts).
 * Os casos "COMPANY → COMPANY inválido", "COMPANY como parent inválido",
 * "GROUP como child inválido" e "segunda relação para mesma COMPANY
 * bloqueada" (pedidos pelo Product Owner) são testados em
 * `CreateOrganizationRelationshipService.test.ts`, não aqui — testá-los
 * neste arquivo exigiria simular um repository dentro de um teste de
 * domínio puro, o que não reflete a fronteira real de responsabilidade.
 */

describe("OrganizationRelationship — 1. GROUP → COMPANY válido (construção do Aggregate)", () => {
  it("cria um OrganizationRelationship com publicId próprio e parent/child corretos", () => {
    const relationship = OrganizationRelationship.create({
      parentOrganizationPublicId: GROUP_PUBLIC_ID,
      childOrganizationPublicId: COMPANY_PUBLIC_ID,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(relationship.getParentOrganizationPublicId().toString()).toBe(GROUP_PUBLIC_ID);
    expect(relationship.getChildOrganizationPublicId().toString()).toBe(COMPANY_PUBLIC_ID);
    expect(relationship.getPublicId().toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // publicId do relacionamento é distinto dos publicIds de parent/child.
    expect(relationship.getPublicId().toString()).not.toBe(GROUP_PUBLIC_ID);
    expect(relationship.getPublicId().toString()).not.toBe(COMPANY_PUBLIC_ID);
  });

  it("rejeita parentOrganizationPublicId malformado (não é a validação de tipo — é validação de formato de UUID)", () => {
    expect(() =>
      OrganizationRelationship.create({
        parentOrganizationPublicId: "nao-e-um-uuid",
        childOrganizationPublicId: COMPANY_PUBLIC_ID,
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    ).toThrow(InvalidOrganizationPublicIdError);
  });

  it("rejeita childOrganizationPublicId malformado", () => {
    expect(() =>
      OrganizationRelationship.create({
        parentOrganizationPublicId: GROUP_PUBLIC_ID,
        childOrganizationPublicId: "nao-e-um-uuid",
        actorPublicId: ACTOR_PUBLIC_ID,
        correlationId: CORRELATION_ID
      })
    ).toThrow(InvalidOrganizationPublicIdError);
  });
});

describe("OrganizationRelationship — 2. reconstituição", () => {
  it("reconstrói um OrganizationRelationship a partir de estado persistido, sem produzir evento", () => {
    const relationship = OrganizationRelationship.reconstitute({
      internalId: 5,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000003",
      parentOrganizationPublicId: GROUP_PUBLIC_ID,
      childOrganizationPublicId: COMPANY_PUBLIC_ID,
      createdAt: new Date("2026-01-01T00:00:00Z")
    });

    expect(relationship.getInternalIdForPersistence()).toBe(5);
    expect(relationship.getParentOrganizationPublicId().toString()).toBe(GROUP_PUBLIC_ID);
    expect(relationship.getChildOrganizationPublicId().toString()).toBe(COMPANY_PUBLIC_ID);
    expect(relationship.pullDomainEvents()).toHaveLength(0);
  });
});

describe("OrganizationRelationship — 3. sem comando de encerramento/movimentação nesta fatia (G1)", () => {
  it("nenhum método de mutação (end/move/update) existe no Aggregate", () => {
    const relationship = OrganizationRelationship.create({
      parentOrganizationPublicId: GROUP_PUBLIC_ID,
      childOrganizationPublicId: COMPANY_PUBLIC_ID,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect((relationship as unknown as { end?: unknown }).end).toBeUndefined();
    expect((relationship as unknown as { move?: unknown }).move).toBeUndefined();
    expect((relationship as unknown as { update?: unknown }).update).toBeUndefined();
  });
});

describe("OrganizationRelationship — 4. evento de domínio organization-relationship.created", () => {
  it("create() produz exatamente um evento organization-relationship.created", () => {
    const relationship = OrganizationRelationship.create({
      parentOrganizationPublicId: GROUP_PUBLIC_ID,
      childOrganizationPublicId: COMPANY_PUBLIC_ID,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    const events = relationship.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("organization-relationship.created");
    expect(events[0]?.aggregatePublicId).toBe(relationship.getPublicId().toString());
    expect(events[0]?.payload).toEqual({
      organizationRelationshipPublicId: relationship.getPublicId().toString(),
      parentOrganizationPublicId: GROUP_PUBLIC_ID,
      childOrganizationPublicId: COMPANY_PUBLIC_ID
    });
  });
});

describe("OrganizationRelationship — 5. não expõe internalId publicamente", () => {
  it("getInternalIdForPersistence é undefined antes de persistir, atribuível só via infraestrutura", () => {
    const relationship = OrganizationRelationship.create({
      parentOrganizationPublicId: GROUP_PUBLIC_ID,
      childOrganizationPublicId: COMPANY_PUBLIC_ID,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });

    expect(relationship.getInternalIdForPersistence()).toBeUndefined();
    relationship.assignInternalIdFromPersistence(11);
    expect(relationship.getInternalIdForPersistence()).toBe(11);
  });
});
