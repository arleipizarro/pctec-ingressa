import type {
  InvitationDelivery,
  InvitationDeliveryOutcome,
  InvitationDeliveryRequest
} from "../../application/InvitationDelivery.js";
import type { InvitationDeliveryMode } from "../../domain/Invitation.js";

export interface InvitationEmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * Transporte de e-mail — porta estreita, uma operação.
 *
 * Estreita de propósito: o Ingressa não deve depender de uma biblioteca
 * de SMTP no seu núcleo, e a única coisa que o caso de uso precisa saber
 * é se a mensagem foi aceita. Quem implementa esta interface é
 * infraestrutura de borda, configurada por `INGRESSA_SMTP_*`.
 */
export interface InvitationEmailTransport {
  send(message: InvitationEmailMessage): Promise<void>;
}

export interface SmtpInvitationDeliveryOptions {
  readonly fromLabel: string;
  readonly supportContact: string;
}

/**
 * Modo `EMAIL` — entrega o convite pelo transporte configurado.
 *
 * **A senha NUNCA é enviada por e-mail, e nenhuma senha é gerada.** O
 * e-mail leva um link de uso único que abre a tela onde a própria pessoa
 * define a senha dela no Ingressa. É a diferença entre entregar uma
 * chave pronta e abrir a porta uma vez para que ela troque a fechadura.
 *
 * O corpo do e-mail segue o padrão dos demais produtos PCTEC (HTML
 * simples, tabela, texto alternativo), mas a CONFIGURAÇÃO é própria do
 * Ingressa (`INGRESSA_SMTP_*`) — nunca compartilhada com o Portal, para
 * que revogar uma credencial de SMTP não derrube o outro produto.
 * Nenhuma credencial de SMTP no Git.
 */
export class SmtpInvitationDelivery implements InvitationDelivery {
  public readonly mode: InvitationDeliveryMode = "EMAIL";

  public constructor(
    private readonly transport: InvitationEmailTransport,
    private readonly options: SmtpInvitationDeliveryOptions
  ) {}

  public async deliver(request: InvitationDeliveryRequest): Promise<InvitationDeliveryOutcome> {
    const validade = request.expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await this.transport.send({
      to: request.email,
      subject: `${this.options.fromLabel} — defina sua senha de acesso`,
      text:
        `Olá, ${request.fullName}.\n\n` +
        `Use o link abaixo para definir sua senha de acesso. Ele vale até ${validade} e só pode ser usado uma vez.\n\n` +
        `${request.link}\n\n` +
        `Se você não esperava este convite, ignore esta mensagem e fale com ${this.options.supportContact}.\n`,
      html:
        `<p>Olá, ${escaparHtml(request.fullName)}.</p>` +
        `<p>Use o botão abaixo para <strong>definir sua senha</strong> de acesso. ` +
        `O link vale até ${escaparHtml(validade)} e só pode ser usado uma vez.</p>` +
        `<p><a href="${escaparHtml(request.link)}">Definir minha senha</a></p>` +
        `<p style="color:#64748b;font-size:12px">Se você não esperava este convite, ignore esta mensagem ` +
        `e fale com ${escaparHtml(this.options.supportContact)}.</p>`
    });
    // Nenhum `manualLink` aqui: entregue por canal externo, o link não
    // volta para a tela de quem convidou.
    return { delivered: true };
  }
}

/** O nome vem do banco, mas nome é texto de usuário — nunca interpolado cru em HTML. */
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
