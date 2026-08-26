import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros do provisionamento administrativo de Organization — a criação
 * pela tela, com associação inicial opcional a um grupo.
 *
 * Nenhum destes duplica regra já existente: as regras de tipo do
 * relacionamento (parent BUSINESS_GROUP, child COMPANY) continuam sendo
 * as de `OrganizationRelationshipErrors`, e são reaproveitadas tal como
 * estão. O que nasce aqui é só o que a composição introduziu.
 */

export class OrganizationParentOnlyForCompanyError extends DomainError {
  public readonly code = "ORGANIZATION_PARENT_ONLY_FOR_COMPANY";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      "Somente uma COMPANY pode ser associada a um grupo empresarial. " +
        "Um BUSINESS_GROUP não pertence a outro grupo no modelo atual."
    );
  }
}

/**
 * Grupo inativo recusado ANTES de qualquer escrita.
 *
 * Distinto de `MEMBERSHIP_ORGANIZATION_NOT_ACTIVE`, que fala do vínculo
 * de uma pessoa: aqui o que se recusa é pendurar uma empresa nova numa
 * estrutura que já foi desativada — o resultado seria uma empresa ativa
 * dentro de um grupo morto, visível para ninguém.
 */
export class OrganizationParentNotActiveError extends DomainError {
  public readonly code = "ORGANIZATION_PARENT_NOT_ACTIVE";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("O grupo empresarial escolhido não está ACTIVE.");
  }
}
