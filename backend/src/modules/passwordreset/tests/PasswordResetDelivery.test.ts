import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvitationDeliveryNotConfiguredError } from "../../invitation/domain/errors/InvitationErrors.js";
import type { InvitationEmailMessage } from "../../invitation/infrastructure/delivery/SmtpInvitationDelivery.js";
import { LoginRateLimitPolicy } from "../../security/domain/LoginRateLimitPolicy.js";
import { composePasswordResetDelivery } from "../infrastructure/PasswordResetComposition.js";
import { comporEmailDeRedefinicao } from "../infrastructure/delivery/SmtpPasswordResetDelivery.js";

const LINK = "https://ingressa.example.invalid/redefinir-senha#token-sintetico-de-redefinicao";
const PEDIDO = {
  fullName: "Pessoa <Titular>",
  email: "titular@example.invalid",
  link: LINK,
  expiresAt: new Date("2026-03-01T12:30:00.000Z")
};
const OPCOES = { fromLabel: "PCTEC Ingressa", supportContact: "a PCTEC" };

const SMTP_COMPLETO = {
  mode: "EMAIL" as const,
  smtpHost: "smtp.example.invalid",
  smtpPort: 587,
  smtpUser: "usuario-sintetico",
  smtpPassword: "senha-smtp-sintetica",
  smtpFrom: "PCTEC Ingressa <nao-responda@example.invalid>",
  smtpSecure: undefined,
  requireTls: false
};

describe("e-mail de redefinição", () => {
  it("vai para o titular, leva o link nos dois formatos e diz o que fazer se a pessoa não pediu", () => {
    const mensagem = comporEmailDeRedefinicao(PEDIDO, OPCOES);

    expect(mensagem.to).toBe(PEDIDO.email);
    expect(mensagem.subject).toContain("Redefinição de senha");
    expect(mensagem.text).toContain(LINK);
    expect(mensagem.html).toContain(`href="${LINK}"`);
    expect(mensagem.text).toMatch(/não pediu esta troca, ignore/);
    expect(mensagem.text).toMatch(/só pode ser usado uma vez/);
  });

  it("escapa o nome vindo do banco no HTML", () => {
    const mensagem = comporEmailDeRedefinicao(PEDIDO, OPCOES);
    expect(mensagem.html).toContain("Pessoa &lt;Titular&gt;");
    expect(mensagem.html).not.toContain("<Titular>");
  });

  it("o logotipo usa só a origem do link — nunca o fragmento com o token", () => {
    const mensagem = comporEmailDeRedefinicao(PEDIDO, OPCOES);
    expect(mensagem.html).toContain('src="https://ingressa.example.invalid/marca/logo-ingressa.png"');
    const imagens = mensagem.html.match(/<img[^>]*>/g) ?? [];
    expect(imagens.join("")).not.toContain("token-sintetico");
  });
});

describe("composição da entrega", () => {
  it("EMAIL usa o MESMO transporte SMTP do convite", async () => {
    const enviadas: InvitationEmailMessage[] = [];
    const entrega = composePasswordResetDelivery(SMTP_COMPLETO, {
      send: async (m) => {
        enviadas.push(m);
      }
    });

    await entrega.deliver(PEDIDO);

    expect(entrega.mode).toBe("EMAIL");
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]!.to).toBe(PEDIDO.email);
  });

  it("EMAIL sem SMTP completo falha alto — nunca cai para o log", () => {
    expect(() => composePasswordResetDelivery({ ...SMTP_COMPLETO, smtpHost: "" })).toThrow(
      InvitationDeliveryNotConfiguredError
    );
  });

  it("MANUAL_DEV captura o link no log do processo, sem o e-mail do titular", async () => {
    const linhas: string[] = [];
    const entrega = composePasswordResetDelivery({ ...SMTP_COMPLETO, mode: "MANUAL_DEV" }, undefined, (l) =>
      linhas.push(l)
    );

    await entrega.deliver(PEDIDO);

    expect(entrega.mode).toBe("MANUAL_DEV");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain(LINK);
    expect(linhas[0]).not.toContain(PEDIDO.email);
  });
});

describe("limitador — namespace da redefinição", () => {
  const config = { enabled: true, windowSeconds: 60, maxAttemptsPerIp: 5, maxAttemptsPerIpIdentifier: 2 };
  const entrada = { clientIp: "203.0.113.7", identifier: "Titular@Example.invalid" };

  it("sem namespace, as chaves do LOGIN continuam byte a byte as de antes", () => {
    const sha = (...partes: string[]): string => createHash("sha256").update(partes.join("\u0000"), "utf8").digest("hex");
    const [ip, ipEmail] = new LoginRateLimitPolicy(config).buildBuckets(entrada);

    expect(ip!.key).toBe(sha("ip", "203.0.113.7"));
    expect(ipEmail!.key).toBe(sha("ip-identifier", "203.0.113.7", "titular@example.invalid"));
  });

  it("com namespace, nenhum contador coincide com os do login", () => {
    const login = new LoginRateLimitPolicy(config).buildBuckets(entrada).map((b) => b.key);
    const redefinicao = new LoginRateLimitPolicy(config, "password-reset").buildBuckets(entrada).map((b) => b.key);

    expect(redefinicao).toHaveLength(2);
    for (const chave of redefinicao) {
      expect(login).not.toContain(chave);
    }
  });
});
