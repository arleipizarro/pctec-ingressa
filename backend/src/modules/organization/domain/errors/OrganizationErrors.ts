import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros de domínio do bounded context `organization`, conforme
 * ADR-031 e ORGANIZATION-MEMBERSHIP-DESIGN.md — G1 (Organization
 * Foundation, v0.6.x).
 */

export class OrganizationNotFoundError extends DomainError {
  public readonly code = "ORGANIZATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(identifier: string) {
    super(`Organization não encontrada: ${identifier}.`);
  }
}

/**
 * `document_number` já usado por outra Organization do MESMO `type`
 * (unicidade condicionada ao par `document_number, type` —
 * `uk_organizations_document_type`, migration 0010). Duas Organizations
 * de tipos diferentes podem, em tese, colidir em documentNumber sem
 * violar a constraint do banco — cenário não esperado na prática (CNPJ é
 * de uma entidade legal específica), mas não é este VO/serviço que
 * decide isso; é a constraint do banco, refletida aqui só como
 * resultado observável.
 */
export class OrganizationDocumentAlreadyExistsError extends DomainError {
  public readonly code = "ORGANIZATION_DOCUMENT_ALREADY_EXISTS";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super("Já existe uma Organization com este documentNumber para este type.");
  }
}
