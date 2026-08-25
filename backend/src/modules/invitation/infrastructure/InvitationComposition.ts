import type { InvitationDelivery } from "../application/InvitationDelivery.js";
import { InvitationDeliveryNotConfiguredError } from "../domain/errors/InvitationErrors.js";
import { ManualDevInvitationDelivery } from "./delivery/ManualDevInvitationDelivery.js";
import {
  SmtpInvitationDelivery,
  type InvitationEmailTransport
} from "./delivery/SmtpInvitationDelivery.js";

export interface InvitationDeliveryConfig {
  readonly mode: "MANUAL_DEV" | "EMAIL";
  readonly smtpHost: string;
  readonly smtpUser: string;
  readonly smtpPassword: string;
  readonly smtpFrom: string;
}

/**
 * Escolhe o adaptador de entrega — e falha de forma AUDÍVEL quando o
 * modo pedido não tem como funcionar.
 *
 * `INVITATION_DELIVERY_MODE=EMAIL` sem `INGRESSA_SMTP_*` completos, ou
 * sem transporte injetado, lança `InvitationDeliveryNotConfiguredError`
 * citando os NOMES das variáveis ausentes — nunca os valores. O que este
 * arquivo nunca faz é cair de volta para `MANUAL_DEV`: um fallback
 * silencioso transformaria "configuração de produção incompleta" em
 * "links de acesso aparecendo na tela do administrador", que é
 * exatamente o cenário que o gate de produção em `env.ts` existe para
 * impedir.
 *
 * **O transporte SMTP concreto ainda não está ligado neste ambiente** —
 * o backend do Ingressa não carrega biblioteca de e-mail, e a decisão
 * consciente foi não adicioná-la antes de haver SMTP de DEV para
 * validar contra. `SmtpInvitationDelivery` já existe e recebe o
 * transporte por injeção: ligar o modo EMAIL é fornecer um
 * `InvitationEmailTransport` aqui, sem tocar em caso de uso ou domínio.
 * Até lá, pedir EMAIL é um erro operacional explícito — nunca um e-mail
 * que dizemos ter enviado.
 */
export function composeInvitationDelivery(
  config: InvitationDeliveryConfig,
  transport?: InvitationEmailTransport
): InvitationDelivery {
  if (config.mode === "MANUAL_DEV") {
    return new ManualDevInvitationDelivery();
  }

  const ausentes: string[] = [];
  if (config.smtpHost.trim().length === 0) {
    ausentes.push("INGRESSA_SMTP_HOST");
  }
  if (config.smtpUser.trim().length === 0) {
    ausentes.push("INGRESSA_SMTP_USER");
  }
  if (config.smtpPassword.trim().length === 0) {
    ausentes.push("INGRESSA_SMTP_PASSWORD");
  }
  if (config.smtpFrom.trim().length === 0) {
    ausentes.push("INGRESSA_SMTP_FROM");
  }
  if (ausentes.length > 0) {
    throw new InvitationDeliveryNotConfiguredError(`variáveis ausentes: ${ausentes.join(", ")}`);
  }
  if (transport === undefined) {
    throw new InvitationDeliveryNotConfiguredError(
      "modo EMAIL pedido, mas nenhum transporte SMTP está ligado neste build"
    );
  }

  return new SmtpInvitationDelivery(transport, {
    fromLabel: "PCTEC Ingressa",
    supportContact: "a PCTEC"
  });
}
