import nodemailer, { type Transporter } from "nodemailer";

import { InvitationDeliveryFailedError } from "../../domain/errors/InvitationErrors.js";
import type { InvitationEmailMessage, InvitationEmailTransport } from "./SmtpInvitationDelivery.js";

/**
 * Configuração do transporte SMTP — valores vêm de `INGRESSA_SMTP_*`,
 * NUNCA de outro produto em runtime.
 *
 * A origem OPERACIONAL inicial desses valores é o `.env` do PCTEC Hub
 * (decisão do Product Owner, registrada em `docs/07-operacao/`), mas a
 * cópia é feita UMA VEZ, na mão, para o `.env` próprio do Ingressa. O
 * processo do Ingressa nunca abre, lê ou referencia o arquivo do Hub —
 * um `symlink` ou uma leitura cruzada transformaria uma decisão
 * operacional reversível numa dependência de runtime entre dois
 * produtos.
 */
export interface SmtpTransportConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** Remetente já validado (`INGRESSA_SMTP_FROM`). */
  readonly from: string;
  /**
   * `true` → TLS IMPLÍCITO: a conexão já nasce cifrada (porta 465).
   * `false` → conexão em claro que precisa ser elevada por STARTTLS
   * (porta 587). Nunca inferido silenciosamente aqui: quem decide é
   * `resolveSmtpSecure`, a partir de configuração explícita, com a
   * derivação por porta documentada.
   */
  readonly secure: boolean;
  /**
   * `true` → recusa entregar por conexão que não tenha sido cifrada.
   * Em produção é SEMPRE `true` (ver `composeInvitationDelivery`): sem
   * isso, um servidor SMTP que simplesmente não anuncie STARTTLS faria
   * a senha e o link do convite viajarem em claro, e o envio ainda
   * assim "daria certo".
   */
  readonly requireTls: boolean;
}

/**
 * Resolve o modo de TLS a partir de configuração EXPLÍCITA, com
 * derivação documentada por porta quando a variável não é informada.
 *
 * A derivação não é um fallback de segurança — é a convenção universal
 * de SMTP (465 = TLS implícito; 587 = submissão com STARTTLS), e ela
 * nunca ENFRAQUECE a conexão: `requireTls` continua obrigando a
 * elevação em produção mesmo quando `secure` é `false`. Deixar isso
 * implícito seria pior do que derivar: um operador que escreve
 * `INGRESSA_SMTP_PORT=465` e esquece `INGRESSA_SMTP_SECURE` receberia um
 * erro de handshake incompreensível em vez de uma conexão correta.
 */
export function resolveSmtpSecure(port: number, configured: boolean | undefined): boolean {
  if (configured !== undefined) {
    return configured;
  }
  return port === 465;
}

/**
 * Transporte concreto sobre `nodemailer`.
 *
 * **Nenhuma verificação de rede na construção.** `createTransport` não
 * abre socket — e `verify()` NÃO é chamado, nem aqui nem no boot. Um
 * SMTP momentaneamente fora do ar não pode impedir o backend de subir
 * nem derrubar `/health`, autenticação ou qualquer rota: a única coisa
 * que falha é a operação de convite, e ela pode ser repetida.
 *
 * **Nada de segredo em erro.** `nodemailer` inclui host, porta e às
 * vezes a resposta do servidor na mensagem de erro. Essa mensagem é
 * descartada e substituída por `InvitationDeliveryFailedError`, que
 * carrega apenas um código estável e um texto de domínio. O erro
 * original nunca é relançado, logado ou anexado como `cause`.
 */
export class NodemailerInvitationEmailTransport implements InvitationEmailTransport {
  private readonly transporter: Transporter;

  public constructor(
    private readonly config: SmtpTransportConfig,
    transporter?: Transporter
  ) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: config.requireTls,
        auth: { user: config.user, pass: config.password }
      });
  }

  public async send(message: InvitationEmailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html
      });
    } catch {
      // Deliberadamente sem `cause` e sem log do erro original: a
      // mensagem do driver pode conter credencial, endereço interno ou
      // trechos do envelope — inclusive o link do convite.
      throw new InvitationDeliveryFailedError();
    }
  }
}
