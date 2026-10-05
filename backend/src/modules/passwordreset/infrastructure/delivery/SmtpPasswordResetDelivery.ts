import type {
  PasswordResetDelivery,
  PasswordResetDeliveryMode,
  PasswordResetDeliveryRequest
} from "../../application/PasswordResetDelivery.js";
import {
  COR,
  FONTE,
  escaparHtml,
  urlDoLogotipo,
  type InvitationEmailMessage,
  type InvitationEmailTransport
} from "../../../invitation/infrastructure/delivery/SmtpInvitationDelivery.js";

export interface SmtpPasswordResetDeliveryOptions {
  readonly fromLabel: string;
  readonly supportContact: string;
}

/**
 * Modo `EMAIL` — entrega o link pelo MESMO transporte SMTP do convite
 * (`INGRESSA_SMTP_*`), com a mesma identidade visual.
 *
 * **Nenhuma senha é gerada nem enviada.** O e-mail leva um link de uso
 * único e validade curta; a senha nova é escolhida pelo titular na tela
 * do Ingressa.
 */
export class SmtpPasswordResetDelivery implements PasswordResetDelivery {
  public readonly mode: PasswordResetDeliveryMode = "EMAIL";

  public constructor(
    private readonly transport: InvitationEmailTransport,
    private readonly options: SmtpPasswordResetDeliveryOptions
  ) {}

  public async deliver(request: PasswordResetDeliveryRequest): Promise<void> {
    await this.transport.send(comporEmailDeRedefinicao(request, this.options));
  }
}

function formatarValidade(expiresAt: Date): string {
  return expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * Compõe assunto, HTML e texto puro da mesma mensagem.
 *
 * Exportada para que os testes verifiquem o CONTEÚDO sem transporte.
 * O texto diz o que fazer se a pessoa NÃO pediu a troca — é o único
 * sinal que um titular recebe de que alguém digitou o e-mail dele no
 * formulário, e "ignore" precisa ser uma resposta segura: sem clicar,
 * nada muda.
 */
export function comporEmailDeRedefinicao(
  request: PasswordResetDeliveryRequest,
  options: SmtpPasswordResetDeliveryOptions
): InvitationEmailMessage {
  const nome = request.fullName.trim();
  const saudacao = nome.length === 0 ? "Olá." : `Olá, ${nome}.`;
  const validade = formatarValidade(request.expiresAt);
  const logo = urlDoLogotipo(request.link);
  const marca = escaparHtml(options.fromLabel);
  const linkSeguro = escaparHtml(request.link);
  const paragrafo = `margin:0 0 14px;font:400 15px/1.6 ${FONTE};color:${COR.texto};`;

  const text =
    `${saudacao}\n\n` +
    `Recebemos um pedido para redefinir a senha da sua conta no ${options.fromLabel}.\n\n` +
    `Para escolher uma nova senha, use o endereço abaixo:\n${request.link}\n\n` +
    `O link vale até ${validade} e só pode ser usado uma vez. Ao concluir, as sessões ` +
    `abertas com a senha antiga serão encerradas.\n\n` +
    `Se você não pediu esta troca, ignore este e-mail: sua senha continua a mesma. ` +
    `Se receber esta mensagem repetidamente sem ter pedido, fale com ${options.supportContact}.\n\n` +
    `Atenciosamente,\nEquipe PCTEC\n`;

  const cabecalho =
    (logo === null
      ? ""
      : `<img src="${escaparHtml(logo)}" width="150" alt="${marca}" ` +
        `style="display:block;margin:0 auto 12px;width:150px;max-width:60%;height:auto;border:0;" />`) +
    `<div style="font:700 18px/1.3 ${FONTE};color:${COR.marcaProfunda};">${marca}</div>`;

  const html =
    `<!doctype html><html lang="pt-BR"><head>` +
    `<meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width,initial-scale=1" />` +
    `<title>Redefinição de senha — ${marca}</title>` +
    `</head>` +
    `<body style="margin:0;padding:0;background:${COR.fundo};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">` +
    `Redefina sua senha de acesso ao ${marca}.</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${COR.fundo};padding:24px 12px;"><tr><td align="center">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ` +
    `style="width:100%;max-width:600px;background:${COR.cartao};border:1px solid ${COR.borda};` +
    `border-radius:12px;">` +
    `<tr><td align="center" style="padding:28px 28px 8px;">${cabecalho}</td></tr>` +
    `<tr><td style="padding:12px 28px 4px;">` +
    `<p style="${paragrafo}">${escaparHtml(saudacao)}</p>` +
    `<p style="${paragrafo}">Recebemos um pedido para redefinir a senha da sua conta no ${marca}.</p>` +
    `<p style="${paragrafo}">Para escolher uma nova senha, utilize o botão abaixo.</p>` +
    `</td></tr>` +
    `<tr><td align="center" style="padding:6px 28px 18px;">` +
    `<a href="${linkSeguro}" ` +
    `style="display:inline-block;background:${COR.marca};color:#ffffff;text-decoration:none;` +
    `font:700 15px/1 ${FONTE};padding:14px 28px;border-radius:10px;">Redefinir minha senha</a>` +
    `</td></tr>` +
    `<tr><td style="padding:0 28px 18px;">` +
    `<div style="font:400 12px/1.5 ${FONTE};color:${COR.textoMedio};">` +
    `Se o botão não funcionar, copie e cole este endereço no navegador:<br />` +
    `<a href="${linkSeguro}" style="color:${COR.marcaMedia};word-break:break-all;">${linkSeguro}</a>` +
    `</div></td></tr>` +
    `<tr><td style="padding:0 28px 24px;">` +
    `<div style="border-top:1px solid ${COR.borda};padding-top:16px;` +
    `font:400 13px/1.6 ${FONTE};color:${COR.textoMedio};">` +
    `<p style="margin:0 0 10px;">O link vale até <strong>${escaparHtml(validade)}</strong> e só pode ` +
    `ser usado uma vez. Ao concluir, as sessões abertas com a senha antiga serão encerradas.</p>` +
    `<p style="margin:0 0 10px;">Se você não pediu esta troca, ignore este e-mail: sua senha ` +
    `continua a mesma. Se receber esta mensagem repetidamente sem ter pedido, fale com ` +
    `${escaparHtml(options.supportContact)}.</p>` +
    `<p style="margin:0;">Atenciosamente,<br /><strong>Equipe PCTEC</strong></p>` +
    `</div></td></tr>` +
    `</table></td></tr></table></body></html>`;

  return {
    to: request.email,
    subject: `Redefinição de senha — ${options.fromLabel}`,
    text,
    html
  };
}
