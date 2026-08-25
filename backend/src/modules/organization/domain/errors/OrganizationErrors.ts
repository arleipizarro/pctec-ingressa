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

/**
 * A organização mudou entre a leitura da tela e o salvamento.
 *
 * `CONFLICT` → 409, e é o status certo: a requisição estava bem
 * formada e a pessoa tinha permissão; o que mudou foi o mundo. A tela
 * recarrega e mostra o valor atual, em vez de sobrescrever a correção
 * de outra pessoa com um texto que já estava velho quando foi digitado.
 */
export class OrganizationVersionConflictError extends DomainError {
  public readonly code = "ORGANIZATION_VERSION_CONFLICT";
  public readonly classification = "CONFLICT" as const;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Organização foi alterada por outra operação: versão esperada ${expectedVersion}, ` +
        `versão atual ${actualVersion}. Recarregue a tela e revise antes de salvar de novo.`
    );
  }
}
