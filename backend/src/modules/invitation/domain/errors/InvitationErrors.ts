import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Convite inválido: inexistente, expirado, já consumido ou revogado.
 *
 * As quatro causas colapsam numa só resposta externa — mesma decisão de
 * `SessionValidationFailedError` e `SsoAuthorizationCodeExchangeFailedError`.
 * Distinguir "expirado" de "já usado" contaria a quem tem um token
 * antigo que ele um dia foi válido, e para qual pessoa.
 */
export class InvitationNotUsableError extends DomainError {
  public readonly code = "INVITATION_NOT_USABLE";
  public readonly classification = "AUTHENTICATION" as const;

  public constructor(public readonly reason: string) {
    super("Convite inválido, expirado ou já utilizado.");
  }
}

/**
 * A Identity alvo não pode receber convite. Diferente do erro acima,
 * este é ADMINISTRATIVO: quem o lê é o ADMIN autenticado, na tela de
 * convites, e ele precisa saber POR QUE aquela pessoa foi pulada para
 * poder resolver. Por isso `reasonCode` aqui é exposto — não há
 * enumeração possível: o ADMIN já enxerga a lista inteira.
 */
export class IdentityNotInvitableError extends DomainError {
  public readonly code = "IDENTITY_NOT_INVITABLE";
  public readonly classification = "VALIDATION" as const;

  public constructor(public readonly reasonCode: string) {
    super(`Identidade não elegível para convite: ${reasonCode}.`);
  }
}

/** Configuração de entrega ausente/incoerente — erro OPERACIONAL, nunca silencioso. */
export class InvitationDeliveryNotConfiguredError extends DomainError {
  public readonly code = "INVITATION_DELIVERY_NOT_CONFIGURED";
  public readonly classification = "VALIDATION" as const;

  public constructor(motivo: string) {
    // Cita NOMES de variável, nunca valores — um erro de configuração
    // não pode ser o caminho pelo qual a senha de SMTP aparece num log.
    super(`Entrega de convite indisponível: ${motivo}.`);
  }
}
