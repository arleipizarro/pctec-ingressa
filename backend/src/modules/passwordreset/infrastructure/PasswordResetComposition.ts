import type { PasswordResetDelivery } from "../application/PasswordResetDelivery.js";
import {
  composeSmtpEmailTransport,
  type InvitationDeliveryConfig
} from "../../invitation/infrastructure/InvitationComposition.js";
import type { InvitationEmailTransport } from "../../invitation/infrastructure/delivery/SmtpInvitationDelivery.js";
import { ManualDevPasswordResetDelivery } from "./delivery/ManualDevPasswordResetDelivery.js";
import { SmtpPasswordResetDelivery } from "./delivery/SmtpPasswordResetDelivery.js";

/**
 * Escolhe o adaptador de entrega da redefinição de senha a partir da
 * MESMA configuração do convite (`INVITATION_DELIVERY_MODE` +
 * `INGRESSA_SMTP_*`).
 *
 * Uma variável só para os dois e-mails de propósito: um ambiente que
 * envia convite de verdade e "captura" redefinição (ou o contrário)
 * seria uma combinação que ninguém pediu e que alguém esqueceria de
 * desfazer.
 *
 * `EMAIL` com SMTP incompleto lança — nunca cai para o log. Mesma regra
 * de `composeInvitationDelivery`: fallback silencioso transformaria
 * "configuração incompleta" em "links de redefinição no log".
 */
export function composePasswordResetDelivery(
  config: InvitationDeliveryConfig,
  transport?: InvitationEmailTransport,
  log?: (linha: string) => void
): PasswordResetDelivery {
  if (config.mode === "MANUAL_DEV") {
    return new ManualDevPasswordResetDelivery(log);
  }
  return new SmtpPasswordResetDelivery(composeSmtpEmailTransport(config, transport), {
    fromLabel: "PCTEC Ingressa",
    supportContact: "a PCTEC"
  });
}
