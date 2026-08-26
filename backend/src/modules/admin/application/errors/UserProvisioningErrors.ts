import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Erros do provisionamento administrativo de usuário.
 *
 * Só nasce aqui o que a COMPOSIÇÃO introduziu. E-mail duplicado,
 * organização inexistente, organização inativa e conflito de acesso já
 * têm erro próprio nos serviços reaproveitados
 * (`IDENTITY_EMAIL_ALREADY_EXISTS`, `ORGANIZATION_NOT_FOUND`,
 * `MEMBERSHIP_ORGANIZATION_NOT_ACTIVE`,
 * `APPLICATION_ACCESS_ACTIVE_GRANT_CONFLICT`) e continuam vindo de lá.
 */

/**
 * Provisionar sem nenhuma aplicação entregaria uma pessoa que consegue
 * definir senha e não consegue abrir nada — e o convite sequer seria
 * emitido, porque a elegibilidade exige ao menos um `ApplicationAccess`
 * GRANTED. Recusar na entrada é mais honesto que criar o beco sem saída.
 */
export class UserProvisioningApplicationsRequiredError extends DomainError {
  public readonly code = "USER_PROVISIONING_APPLICATIONS_REQUIRED";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("Selecione ao menos uma aplicação para conceder acesso.");
  }
}

/** Aplicação INACTIVE recusada ANTES de qualquer escrita. */
export class UserProvisioningApplicationNotActiveError extends DomainError {
  public readonly code = "USER_PROVISIONING_APPLICATION_NOT_ACTIVE";
  public readonly classification = "VALIDATION" as const;

  constructor(applicationCode: string) {
    super(`A aplicação ${applicationCode} não está ACTIVE.`);
  }
}

/**
 * `ORGANIZATION_AND_DESCENDANTS` numa COMPANY.
 *
 * O Value Object `MembershipScope` aceita a combinação e documenta que
 * ela "não amplia nada na prática" — COMPANY não tem descendentes. Isso
 * é verdade hoje e vira mentira no dia em que COMPANY passar a ter
 * filhos: o vínculo gravado com esse escopo ampliaria alcance
 * silenciosamente, sem ninguém ter decidido isso. Guardar um escopo que
 * só faz sentido para grupo é registrar uma intenção que não existe, e
 * por isso o provisionamento recusa em vez de aceitar e ignorar.
 */
export class UserProvisioningScopeNotAllowedForCompanyError extends DomainError {
  public readonly code = "USER_PROVISIONING_SCOPE_NOT_ALLOWED_FOR_COMPANY";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      "Vínculo em COMPANY aceita apenas o escopo ORGANIZATION_ONLY. " +
        "ORGANIZATION_AND_DESCENDANTS existe para BUSINESS_GROUP."
    );
  }
}
