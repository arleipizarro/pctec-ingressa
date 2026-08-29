import type { InvitationDelivery } from "../application/InvitationDelivery.js";
import { InvitationDeliveryNotConfiguredError } from "../domain/errors/InvitationErrors.js";
import { ManualDevInvitationDelivery } from "./delivery/ManualDevInvitationDelivery.js";
import {
  NodemailerInvitationEmailTransport,
  resolveSmtpSecure
} from "./delivery/NodemailerInvitationEmailTransport.js";
import {
  SmtpInvitationDelivery,
  type InvitationEmailTransport
} from "./delivery/SmtpInvitationDelivery.js";

export interface InvitationDeliveryConfig {
  readonly mode: "MANUAL_DEV" | "EMAIL";
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpUser: string;
  readonly smtpPassword: string;
  readonly smtpFrom: string;
  /**
   * `INGRESSA_SMTP_SECURE` quando informada; `undefined` quando ausente
   * — e aí `resolveSmtpSecure` deriva da porta, com a convenção
   * documentada (465 = TLS implícito).
   */
  readonly smtpSecure: boolean | undefined;
  /** `true` em produção — recusa entrega por conexão não cifrada. */
  readonly requireTls: boolean;
  /**
   * `INGRESSA_PUBLIC_BASE_URL` — a MESMA base de onde sai o link do
   * convite. Serve só para montar a URL absoluta do logotipo no e-mail.
   * Opcional: tem default vazio no `env` e o corpo do e-mail continua
   * correto sem ela.
   */
  readonly publicBaseUrl?: string | undefined;
}

/**
 * Aceita `alguem@dominio` e `Nome Legível <alguem@dominio>`.
 *
 * Validação de FORMA, não de existência da caixa: o objetivo é pegar o
 * remetente vazio ou visivelmente errado no boot, quando ainda dá para
 * corrigir, em vez de descobrir na primeira tentativa de convite que o
 * servidor recusou o envelope.
 */
const REMETENTE_VALIDO = /^(?:[^<>]*<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/u;

export function isValidSmtpFrom(valor: string): boolean {
  return REMETENTE_VALIDO.test(valor.trim());
}

/**
 * Escolhe o adaptador de entrega — e falha de forma AUDÍVEL quando o
 * modo pedido não tem como funcionar.
 *
 * `INVITATION_DELIVERY_MODE=EMAIL` sem `INGRESSA_SMTP_*` completos lança
 * `InvitationDeliveryNotConfiguredError` citando os NOMES das variáveis
 * ausentes — nunca os valores. O que este arquivo nunca faz é cair de
 * volta para `MANUAL_DEV`: um fallback silencioso transformaria
 * "configuração de produção incompleta" em "links de acesso aparecendo
 * na tela do administrador", que é exatamente o cenário que o gate de
 * produção em `env.ts` existe para impedir.
 *
 * **v1.0 — o transporte concreto agora está ligado.** Até esta fatia,
 * pedir `EMAIL` lançava mesmo com as variáveis completas, porque nenhum
 * `InvitationEmailTransport` era construído aqui: o backend não carregava
 * biblioteca de e-mail. Consequência prática, descoberta no preflight de
 * produção, é que NENHUM valor de `INVITATION_DELIVERY_MODE` permitia o
 * boot com `NODE_ENV=production` — `MANUAL_DEV` era recusado por
 * `loadEnv()` e `EMAIL` era recusado aqui. Com `nodemailer` ligado, o
 * impasse deixa de existir.
 *
 * O parâmetro `transport` permanece, e continua sendo por onde os testes
 * injetam um dublê. Ele nunca é exigido em produção — quando ausente,
 * este composer constrói o transporte real.
 *
 * **Nenhuma conexão de rede acontece aqui.** Construir o transporte não
 * abre socket e não chama `verify()`: um SMTP fora do ar não pode
 * impedir o processo de subir.
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
  if (!isValidSmtpFrom(config.smtpFrom)) {
    // Cita o NOME da variável e o defeito, nunca o valor.
    throw new InvitationDeliveryNotConfiguredError(
      "INGRESSA_SMTP_FROM não é um remetente válido (use alguem@dominio ou Nome <alguem@dominio>)"
    );
  }

  const transporteEfetivo =
    transport ??
    new NodemailerInvitationEmailTransport({
      host: config.smtpHost.trim(),
      port: config.smtpPort,
      user: config.smtpUser.trim(),
      password: config.smtpPassword,
      from: config.smtpFrom.trim(),
      secure: resolveSmtpSecure(config.smtpPort, config.smtpSecure),
      requireTls: config.requireTls
    });

  return new SmtpInvitationDelivery(transporteEfetivo, {
    fromLabel: "PCTEC Ingressa",
    supportContact: "a PCTEC",
    publicBaseUrl: config.publicBaseUrl
  });
}
