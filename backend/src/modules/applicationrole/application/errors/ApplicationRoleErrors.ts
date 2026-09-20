import { DomainError } from "../../../../shared/errors/DomainError.js";

/** A aplicação informada não existe ou não está ACTIVE. */
export class ApplicationRoleApplicationNotFoundError extends DomainError {
  public readonly code = "APPLICATION_ROLE_APPLICATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(applicationCode: string) {
    super(`Aplicação "${applicationCode}" não encontrada ou inativa.`);
  }
}

/**
 * O perfil pedido não existe NO CATÁLOGO DA APLICAÇÃO informada.
 *
 * Recusa explícita e nunca criação sob demanda: um perfil que nasce
 * porque alguém digitou o código dele é exatamente a "string arbitrária
 * aceita silenciosamente" que ADR-028 proíbe. O catálogo cresce por
 * migration revisada, não por requisição.
 */
export class ApplicationRoleNotInCatalogError extends DomainError {
  public readonly code = "APPLICATION_ROLE_NOT_IN_CATALOG";
  public readonly classification = "VALIDATION" as const;

  constructor(roleCode: string, applicationCode: string) {
    super(`O perfil "${roleCode}" não existe no catálogo ativo de "${applicationCode}".`);
  }
}

/** Identidade inexistente, excluída, ou sem acesso GRANTED à aplicação. */
export class ApplicationRoleIdentityNotEligibleError extends DomainError {
  public readonly code = "APPLICATION_ROLE_IDENTITY_NOT_ELIGIBLE";
  public readonly classification = "CONFLICT" as const;

  constructor() {
    super(
      "A identidade precisa existir e ter acesso concedido à aplicação antes de receber um perfil dentro dela."
    );
  }
}

/** A concessão pedida para revogação não existe ou já está revogada. */
export class ApplicationRoleAssignmentNotFoundError extends DomainError {
  public readonly code = "APPLICATION_ROLE_ASSIGNMENT_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("Concessão de perfil não encontrada ou já revogada.");
  }
}
