export type PasswordResetDeliveryMode = "MANUAL_DEV" | "EMAIL";

export interface PasswordResetDeliveryRequest {
  readonly fullName: string;
  readonly email: string;
  /** Link COMPLETO, com o token no fragmento. Nunca persistido, nunca auditado. */
  readonly link: string;
  readonly expiresAt: Date;
}

/**
 * Porta de entrega do link de redefinição.
 *
 * Diferente do convite, aqui NÃO existe "mostrar o link a quem pediu":
 * quem pede é anônimo, e devolver o link na resposta seria entregar a
 * conta de qualquer e-mail a quem o digitasse. O link só sai por um
 * canal que pertence ao titular — o e-mail cadastrado.
 */
export interface PasswordResetDelivery {
  readonly mode: PasswordResetDeliveryMode;
  deliver(request: PasswordResetDeliveryRequest): Promise<void>;
}
