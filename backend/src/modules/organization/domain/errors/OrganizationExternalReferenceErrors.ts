import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de domínio de `OrganizationExternalReference`, conforme
 * ADR-031 e ORGANIZATION-MEMBERSHIP-DESIGN.md §9.1 — G2, v0.6.x.
 */

export class OrganizationExternalReferenceOrganizationNotFoundError extends DomainError {
  public readonly code = "ORGANIZATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(organizationPublicId: string) {
    super(`Organization não encontrada: ${organizationPublicId}.`);
  }
}

/**
 * `existsActiveBySystemCodeEntityTypeAndLegacyId` já retornou `true` —
 * já existe uma referência **ACTIVE** para este (systemCode, entityType,
 * legacyId). Referências `SUPERSEDED` não contam (podem coexistir
 * livremente como histórico, migration 0013). Nunca resolvido
 * silenciosamente — cabe a quem chama decidir (ex.: o processo de
 * bootstrap/matching, fora de escopo G2) se isso é MATCHED (já existe,
 * ok) ou CONFLICT (aponta para Organization diferente da esperada).
 */
export class OrganizationExternalReferenceAlreadyExistsError extends DomainError {
  public readonly code = "ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe uma OrganizationExternalReference ACTIVE para este (systemCode, entityType, legacyId).");
  }
}
