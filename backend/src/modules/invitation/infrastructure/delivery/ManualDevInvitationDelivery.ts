import type {
  InvitationDelivery,
  InvitationDeliveryOutcome,
  InvitationDeliveryRequest
} from "../../application/InvitationDelivery.js";
import type { InvitationDeliveryMode } from "../../domain/Invitation.js";

/**
 * Modo `MANUAL_DEV` — o link volta UMA ÚNICA VEZ para a tela de quem
 * convidou, que o entrega pelo canal que já usa com aquela pessoa.
 *
 * Três coisas que este adaptador deliberadamente NÃO faz:
 *
 * - **não loga o link** (nem em `console`, nem em auditoria): um token
 *   em log é um token que sobrevive à sessão de quem o viu;
 * - **não persiste o token em claro** — quem persiste é o repositório, e
 *   só o hash;
 * - **não diz que enviou e-mail.** `delivered: false` é a resposta
 *   honesta, e a UI mostra o que realmente aconteceu.
 */
export class ManualDevInvitationDelivery implements InvitationDelivery {
  public readonly mode: InvitationDeliveryMode = "MANUAL_DEV";

  public async deliver(request: InvitationDeliveryRequest): Promise<InvitationDeliveryOutcome> {
    return { delivered: false, manualLink: request.link };
  }
}
