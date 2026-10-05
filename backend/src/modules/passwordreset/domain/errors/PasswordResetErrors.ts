import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Link de redefinição inválido: inexistente, expirado, já usado,
 * substituído por um pedido mais novo — ou a conta deixou de poder ter a
 * senha redefinida entre o pedido e a troca.
 *
 * Todas as causas colapsam numa só resposta externa, mesma decisão de
 * `InvitationNotUsableError`: distinguir "expirado" de "já usado"
 * contaria a quem tem um link antigo que ele um dia foi válido. A tela
 * oferece o mesmo remédio para todos os casos — pedir um link novo.
 *
 * `reason` é só para teste e diagnóstico; nunca sai na resposta.
 */
export class PasswordResetNotUsableError extends DomainError {
  public readonly code = "PASSWORD_RESET_NOT_USABLE";
  public readonly classification = "AUTHENTICATION" as const;

  public constructor(public readonly reason: string) {
    super("Link de redefinição inválido, expirado ou já utilizado.");
  }
}
