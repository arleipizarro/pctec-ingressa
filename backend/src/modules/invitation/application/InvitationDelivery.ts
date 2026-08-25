import type { InvitationDeliveryMode } from "../domain/Invitation.js";

export interface InvitationDeliveryRequest {
  readonly identityPublicId: string;
  readonly fullName: string;
  readonly email: string;
  /** Link COMPLETO, com o token no fragmento. Nunca logado, nunca persistido. */
  readonly link: string;
  readonly expiresAt: Date;
}

export interface InvitationDeliveryOutcome {
  /**
   * `true` somente quando um canal externo REALMENTE aceitou a mensagem.
   * O modo manual devolve `false` — e é o ponto: a tela precisa dizer
   * "copie este link e entregue", nunca "e-mail enviado".
   */
  readonly delivered: boolean;
  /**
   * Link a ser mostrado UMA ÚNICA VEZ a quem convidou (modo manual).
   * Ausente em qualquer modo que entregue por canal externo — nesse
   * caso o link não volta para a tela do administrador.
   */
  readonly manualLink?: string;
}

/**
 * Porta de entrega do convite.
 *
 * Existe para que a decisão "como este link chega à pessoa" fique fora
 * do caso de uso: o serviço que cria o convite não muda quando o
 * ambiente ganha SMTP. E, principalmente, para que o modo manual seja um
 * ADAPTADOR EXPLÍCITO, e não um `catch` silencioso em volta de um envio
 * que falhou.
 */
export interface InvitationDelivery {
  readonly mode: InvitationDeliveryMode;
  deliver(request: InvitationDeliveryRequest): Promise<InvitationDeliveryOutcome>;
}
