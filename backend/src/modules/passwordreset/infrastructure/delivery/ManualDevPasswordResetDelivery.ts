import type {
  PasswordResetDelivery,
  PasswordResetDeliveryMode,
  PasswordResetDeliveryRequest
} from "../../application/PasswordResetDelivery.js";

/**
 * Modo `MANUAL_DEV` — captura do e-mail no log do PRÓPRIO processo.
 *
 * No convite, o modo manual devolve o link à tela do ADMIN que o pediu.
 * Aqui isso é impossível: quem pede é anônimo, e a resposta precisa ser
 * a mesma exista o e-mail ou não. Sobra um único lugar para o link
 * aparecer num ambiente sem SMTP — o log do servidor, que só quem opera
 * a máquina lê.
 *
 * É a ÚNICA exceção ao "token nunca em log" do Ingressa, e ela é
 * cercada por três coisas:
 *
 * - `INVITATION_DELIVERY_MODE=MANUAL_DEV` é RECUSADO com
 *   `NODE_ENV=production` (`loadEnv`) — este adaptador não existe em
 *   produção;
 * - o link vale no máximo 60 minutos e uma vez só;
 * - o e-mail do titular NÃO entra na linha, só o link — o log não vira
 *   uma lista de quem pediu.
 */
export class ManualDevPasswordResetDelivery implements PasswordResetDelivery {
  public readonly mode: PasswordResetDeliveryMode = "MANUAL_DEV";

  public constructor(private readonly log: (linha: string) => void = (linha) => console.info(linha)) {}

  public async deliver(request: PasswordResetDeliveryRequest): Promise<void> {
    this.log(
      `[password-reset][MANUAL_DEV] e-mail não enviado (sem SMTP neste ambiente). ` +
        `Link de redefinição, válido até ${request.expiresAt.toISOString()}: ${request.link}`
    );
  }
}
