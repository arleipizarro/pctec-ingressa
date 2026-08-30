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

/** Paleta índigo do HUB/Ingressa. Cliente de e-mail não lê custom property. */
const COR = {
  fundo: "#f5f4fa",
  cartao: "#ffffff",
  borda: "#e2daf0",
  marca: "#3d2080",
  marcaProfunda: "#1e1040",
  marcaMedia: "#5b3fa6",
  selecao: "#f0ebff",
  texto: "#1e1040",
  textoMedio: "#4b3d6a"
} as const;

const FONTE = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Produtos citados como EXEMPLO do que o Ingressa dá acesso.
 *
 * A frase que os introduz diz "os sistemas liberados para o seu perfil,
 * como:" — nunca "você terá acesso a". A composição não conhece os
 * `ApplicationAccess` de quem recebe, e prometer aqui um acesso que o
 * administrador não concedeu seria mentir na primeira mensagem que a
 * pessoa recebe da PCTEC.
 */
const PRODUTOS: readonly { readonly nome: string; readonly descricao: string }[] = [
  {
    nome: "Portal do Cliente",
    descricao: "Acompanhe seus contratos, equipamentos, informações financeiras e chamados."
  },
  {
    nome: "PCTEC Helpdesk",
    descricao: "Registre e acompanhe solicitações, dúvidas e incidentes junto à nossa equipe."
  }
];

/**
 * Modo `EMAIL` — entrega o convite pelo transporte configurado.
 *
 * **A senha NUNCA é enviada por e-mail, e nenhuma senha é gerada.** O
 * e-mail leva um link de uso único que abre a tela onde a própria pessoa
 * define a senha dela no Ingressa. É a diferença entre entregar uma
 * chave pronta e abrir a porta uma vez para que ela troque a fechadura.
 *
 * O corpo é montado com tabela e CSS inline porque cliente de e-mail não
 * tem `<style>` confiável, não tem flexbox e não tem grid. A
 * CONFIGURAÇÃO é própria do Ingressa (`INGRESSA_SMTP_*`) — nunca
 * compartilhada com o Portal, para que revogar uma credencial de SMTP
 * não derrube o outro produto. Nenhuma credencial de SMTP no Git.
 */
export class SmtpInvitationDelivery implements InvitationDelivery {
  public readonly mode: InvitationDeliveryMode = "EMAIL";

  public constructor(
    private readonly transport: InvitationEmailTransport,
    private readonly options: SmtpInvitationDeliveryOptions
  ) {}

  public async deliver(request: InvitationDeliveryRequest): Promise<InvitationDeliveryOutcome> {
    await this.transport.send(comporEmailDeConvite(request, this.options));
    // Nenhum `manualLink` aqui: entregue por canal externo, o link não
    // volta para a tela de quem convidou.
    return { delivered: true };
  }
}

/**
 * Compõe assunto, HTML e texto puro da mesma mensagem.
 *
 * Exportada para que os testes verifiquem o CONTEÚDO sem precisar de
 * transporte, de SMTP ou de rede.
 */
export function comporEmailDeConvite(
  request: InvitationDeliveryRequest,
  options: SmtpInvitationDeliveryOptions
): InvitationEmailMessage {
  const nome = nomeConfiavel(request.fullName);
  const validade = formatarValidade(request.expiresAt);
  const logo = urlDoLogotipo(request.link);
  const saudacao = nome === null ? "Olá." : `Olá, ${nome}.`;

  return {
    to: request.email,
    subject: `Bem-vindo ao ${options.fromLabel} — crie sua senha`,
    text: montarTexto({ saudacao, validade, options, link: request.link }),
    html: montarHtml({ saudacao, validade, options, link: request.link, logo })
  };
}

/**
 * Nome só quando ele existe de verdade.
 *
 * `fullName` é obrigatório no contrato, mas "obrigatório" no tipo não
 * impede string vazia ou só espaços vindo do banco. Nesse caso a
 * mensagem cumprimenta sem nome — o que NUNCA acontece é derivar um
 * nome do e-mail: "joao.silva@" viraria "Joao Silva" por adivinhação, e
 * errar o nome de alguém logo no primeiro contato é pior do que omitir.
 */
function nomeConfiavel(fullName: string): string | null {
  const limpo = fullName.trim();
  return limpo.length === 0 ? null : limpo;
}

/** Validade real do convite, no fuso de quem lê. Nunca inventada. */
function formatarValidade(expiresAt: Date): string {
  return expiresAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * URL absoluta do logotipo, derivada do PRÓPRIO link do convite — ou
 * `null` quando não dá para derivar com segurança.
 *
 * **Por que do link, e não de uma config própria.** O link já é o
 * endereço definitivo, montado a montante a partir de
 * `INGRESSA_PUBLIC_BASE_URL`. Carregar a mesma base uma segunda vez até
 * aqui, só para a imagem, seria duplicar a origem — e duas fontes para o
 * mesmo dado é uma que pode divergir da outra.
 *
 * **Só `origin`, nunca concatenação da string.** `new URL(...).origin`
 * devolve exclusivamente esquema, host e porta: `pathname`, query,
 * fragmento (onde vive o token) e credenciais ficam de fora por
 * construção, não por confiança em `replace`. Um `src` montado colando
 * texto poderia arrastar o token do convite para dentro do atributo de
 * uma imagem — que é justamente o lugar de onde ele vazaria por
 * `Referer` ou por proxy de imagem.
 *
 * Esquema fora de http/https, URL relativa ou valor inválido devolvem
 * `null`, e aí o cabeçalho cai para o nome do produto em texto — que é
 * o que já aparece quando as imagens estão bloqueadas.
 */
export function urlDoLogotipo(link: string): string | null {
  let convite: URL;
  try {
    convite = new URL(link);
  } catch {
    // Relativa ou malformada não vira `src`: melhor sem logotipo do que
    // com uma imagem quebrada no e-mail de boas-vindas.
    return null;
  }
  if (convite.protocol !== "http:" && convite.protocol !== "https:") {
    return null;
  }
  return `${convite.origin}/marca/logo-ingressa.png`;
}

function montarTexto({
  saudacao,
  validade,
  options,
  link
}: {
  saudacao: string;
  validade: string;
  options: SmtpInvitationDeliveryOptions;
  link: string;
}): string {
  const produtos = PRODUTOS.map((p) => `- ${p.nome}\n  ${p.descricao}`).join("\n\n");
  return (
    `${saudacao}\n\n` +
    `Bem-vindo ao ${options.fromLabel}, a central de acesso às aplicações da PCTEC.\n\n` +
    `Por meio do Ingressa, você poderá acessar com segurança os sistemas liberados ` +
    `para o seu perfil, como:\n\n` +
    `${produtos}\n\n` +
    `Para começar, use o endereço abaixo e defina sua senha de acesso.\n\n` +
    `Criar minha senha:\n${link}\n\n` +
    `Este convite é pessoal e não deve ser compartilhado. Por segurança, o link ` +
    `possui prazo de validade: vale até ${validade} e só pode ser usado uma vez.\n\n` +
    `Se você não esperava receber esta mensagem, ignore este e-mail ou entre em ` +
    `contato com ${options.supportContact}.\n\n` +
    `Atenciosamente,\nEquipe PCTEC\n`
  );
}

function montarHtml({
  saudacao,
  validade,
  options,
  link,
  logo
}: {
  saudacao: string;
  validade: string;
  options: SmtpInvitationDeliveryOptions;
  link: string;
  logo: string | null;
}): string {
  const marca = escaparHtml(options.fromLabel);
  const linkSeguro = escaparHtml(link);

  // Cabeçalho: logotipo quando há base pública confiável, e SEMPRE o
  // nome do produto em texto logo abaixo — com imagem bloqueada, que é o
  // padrão de vários clientes, a mensagem continua se identificando.
  const cabecalho =
    (logo === null
      ? ""
      : `<img src="${escaparHtml(logo)}" width="150" alt="${marca}" ` +
        `style="display:block;margin:0 auto 12px;width:150px;max-width:60%;height:auto;border:0;" />`) +
    `<div style="font:700 18px/1.3 ${FONTE};color:${COR.marcaProfunda};">${marca}</div>` +
    `<div style="font:400 13px/1.4 ${FONTE};color:${COR.textoMedio};margin-top:4px;">` +
    `Central de acesso às aplicações da PCTEC</div>`;

  const listaDeProdutos = PRODUTOS.map(
    (p) =>
      `<tr><td style="padding:10px 14px;background:${COR.selecao};border-radius:8px;">` +
      `<div style="font:700 14px/1.4 ${FONTE};color:${COR.marca};">${escaparHtml(p.nome)}</div>` +
      `<div style="font:400 13px/1.5 ${FONTE};color:${COR.textoMedio};margin-top:2px;">` +
      `${escaparHtml(p.descricao)}</div></td></tr>` +
      `<tr><td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>`
  ).join("");

  const paragrafo = `margin:0 0 14px;font:400 15px/1.6 ${FONTE};color:${COR.texto};`;

  return (
    `<!doctype html><html lang="pt-BR"><head>` +
    `<meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width,initial-scale=1" />` +
    `<title>Bem-vindo ao ${marca}</title>` +
    `</head>` +
    `<body style="margin:0;padding:0;background:${COR.fundo};">` +
    // Pré-cabeçalho: primeira linha da prévia na caixa de entrada, sem
    // ocupar espaço no corpo renderizado.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">` +
    `Crie sua senha de acesso ao ${marca}.</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${COR.fundo};padding:24px 12px;"><tr><td align="center">` +
    // 600px é a largura que atravessa cliente de desktop sem corte;
    // `width:100%` deixa encolher no celular.
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" ` +
    `style="width:100%;max-width:600px;background:${COR.cartao};border:1px solid ${COR.borda};` +
    `border-radius:12px;">` +
    `<tr><td align="center" style="padding:28px 28px 8px;">${cabecalho}</td></tr>` +
    `<tr><td style="padding:12px 28px 4px;">` +
    `<p style="${paragrafo}">${escaparHtml(saudacao)}</p>` +
    `<p style="${paragrafo}">Bem-vindo ao ${marca}, a central de acesso às aplicações da PCTEC.</p>` +
    `<p style="${paragrafo}">Por meio do Ingressa, você poderá acessar com segurança ` +
    `<strong>os sistemas liberados para o seu perfil</strong>, como:</p>` +
    `</td></tr>` +
    `<tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" ` +
    `cellspacing="0" border="0">${listaDeProdutos}</table></td></tr>` +
    `<tr><td style="padding:4px 28px 0;">` +
    `<p style="${paragrafo}">Para começar, utilize o botão abaixo e defina sua senha de acesso.</p>` +
    `</td></tr>` +
    // Botão: `<a>` com padding e cor inline. Nada de <button>, que não
    // é clicável em cliente de e-mail.
    `<tr><td align="center" style="padding:6px 28px 18px;">` +
    `<a href="${linkSeguro}" ` +
    `style="display:inline-block;background:${COR.marca};color:#ffffff;text-decoration:none;` +
    `font:700 15px/1 ${FONTE};padding:14px 28px;border-radius:10px;">Criar minha senha</a>` +
    `</td></tr>` +
    // O mesmo endereço em texto: cliente que remove o botão, ou pessoa
    // que prefere copiar, continua conseguindo entrar.
    `<tr><td style="padding:0 28px 18px;">` +
    `<div style="font:400 12px/1.5 ${FONTE};color:${COR.textoMedio};">` +
    `Se o botão não funcionar, copie e cole este endereço no navegador:<br />` +
    `<a href="${linkSeguro}" style="color:${COR.marcaMedia};word-break:break-all;">${linkSeguro}</a>` +
    `</div></td></tr>` +
    `<tr><td style="padding:0 28px 24px;">` +
    `<div style="border-top:1px solid ${COR.borda};padding-top:16px;` +
    `font:400 13px/1.6 ${FONTE};color:${COR.textoMedio};">` +
    `<p style="margin:0 0 10px;">Este convite é pessoal e não deve ser compartilhado. ` +
    `Por segurança, o link possui prazo de validade: vale até ` +
    `<strong>${escaparHtml(validade)}</strong> e só pode ser usado uma vez.</p>` +
    `<p style="margin:0 0 10px;">Se você não esperava receber esta mensagem, ignore este ` +
    `e-mail ou entre em contato com ${escaparHtml(options.supportContact)}.</p>` +
    `<p style="margin:0;">Atenciosamente,<br /><strong>Equipe PCTEC</strong></p>` +
    `</div></td></tr>` +
    `</table></td></tr></table></body></html>`
  );
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
