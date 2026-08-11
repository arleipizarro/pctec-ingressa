import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de domínio da hierarquia `OrganizationRelationship`
 * (`BUSINESS_GROUP` -> `COMPANY`), conforme ADR-031 e
 * ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 3 — G1, v0.6.x.
 */

export class OrganizationRelationshipParentMustBeBusinessGroupError extends DomainError {
  public readonly code = "ORGANIZATION_INVALID_RELATIONSHIP";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("parentOrganization de um OrganizationRelationship deve ser do type BUSINESS_GROUP.");
  }
}

export class OrganizationRelationshipChildMustBeCompanyError extends DomainError {
  public readonly code = "ORGANIZATION_INVALID_RELATIONSHIP";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("childOrganization de um OrganizationRelationship deve ser do type COMPANY.");
  }
}

export class OrganizationRelationshipParentNotFoundError extends DomainError {
  public readonly code = "ORGANIZATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string) {
    super(`Organization (parent) não encontrada: ${publicId}.`);
  }
}

export class OrganizationRelationshipChildNotFoundError extends DomainError {
  public readonly code = "ORGANIZATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string) {
    super(`Organization (child) não encontrada: ${publicId}.`);
  }
}

/**
 * `child_organization_public_id` já vinculado a outro
 * `OrganizationRelationship` — no MVP, uma COMPANY pertence a no máximo
 * um BUSINESS_GROUP (`uk_org_rel_child`, migration 0011;
 * ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 3).
 */
export class OrganizationRelationshipChildAlreadyLinkedError extends DomainError {
  public readonly code = "ORGANIZATION_RELATIONSHIP_CHILD_ALREADY_LINKED";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Esta COMPANY já pertence a um BUSINESS_GROUP. No MVP, no máximo um vínculo por COMPANY.");
  }
}
