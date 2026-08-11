import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de domínio de `Membership`, conforme ADR-031 e
 * ORGANIZATION-MEMBERSHIP-DESIGN.md §4 — G2, v0.6.x.
 */

export class MembershipIdentityNotFoundError extends DomainError {
  public readonly code = "IDENTITY_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(identityPublicId: string) {
    super(`Identity não encontrada: ${identityPublicId}.`);
  }
}

export class MembershipOrganizationNotFoundError extends DomainError {
  public readonly code = "ORGANIZATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(organizationPublicId: string) {
    super(`Organization não encontrada: ${organizationPublicId}.`);
  }
}

/**
 * A Organization referenciada existe, mas está `INACTIVE` — Membership
 * só pode ser criado sobre uma Organization utilizável (seção 16 do
 * prompt de implementação G2).
 */
export class MembershipOrganizationNotActiveError extends DomainError {
  public readonly code = "MEMBERSHIP_ORGANIZATION_NOT_ACTIVE";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("A Organization referenciada não está ACTIVE — não é possível criar Membership.");
  }
}

/**
 * `uk_membership_unique (identity_public_id, organization_public_id,
 * profile)` — vínculo com a MESMA classificação já existe para este par
 * Identity/Organization, independente de status (ver nota na migration
 * 0012 sobre revogar+recriar, gap registrado, fora de escopo G2).
 */
export class MembershipAlreadyExistsError extends DomainError {
  public readonly code = "MEMBERSHIP_ALREADY_EXISTS";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe um Membership com esta mesma classificação (identity + organization + profile).");
  }
}
