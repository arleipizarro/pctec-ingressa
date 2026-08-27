import { describe, expect, it, vi } from "vitest";

import { loadEnv } from "../../../app/config/env.js";
import {
  composeInvitationDelivery,
  isValidSmtpFrom,
  type InvitationDeliveryConfig
} from "../infrastructure/InvitationComposition.js";
import { ManualDevInvitationDelivery } from "../infrastructure/delivery/ManualDevInvitationDelivery.js";
import { SmtpInvitationDelivery } from "../infrastructure/delivery/SmtpInvitationDelivery.js";
import {
  NodemailerInvitationEmailTransport,
  resolveSmtpSecure
} from "../infrastructure/delivery/NodemailerInvitationEmailTransport.js";
import {
  InvitationDeliveryFailedError,
  InvitationDeliveryNotConfiguredError
} from "../domain/errors/InvitationErrors.js";

/**
 * NENHUM teste deste arquivo lê configuração real de SMTP, de nenhum
 * produto. Todos os valores abaixo são fictícios e locais ao teste; o
 * `.env` do PCTEC Hub — origem operacional das credenciais em produção —
 * nunca é aberto, nem aqui nem em qualquer outro ponto da suíte.
 * Nenhuma conexão de rede é estabelecida.
 */
const CONFIG_EMAIL_COMPLETA: InvitationDeliveryConfig = {
  mode: "EMAIL",
  smtpHost: "smtp.exemplo.invalid",
  smtpPort: 587,
  smtpUser: "usuario-de-teste",
  smtpPassword: "senha-de-teste-nunca-real",
  smtpFrom: "ingressa@exemplo.invalid",
  smtpSecure: undefined,
  requireTls: true
};

describe("composeInvitationDelivery — modo MANUAL_DEV", () => {
  it("continua funcionando e não exige nenhuma variável de SMTP", () => {
    const delivery = composeInvitationDelivery({
      ...CONFIG_EMAIL_COMPLETA,
      mode: "MANUAL_DEV",
      smtpHost: "",
      smtpUser: "",
      smtpPassword: "",
      smtpFrom: ""
    });

    expect(delivery).toBeInstanceOf(ManualDevInvitationDelivery);
    expect(delivery.mode).toBe("MANUAL_DEV");
  });
});

describe("composeInvitationDelivery — modo EMAIL liga o transporte concreto", () => {
  it("constrói o transporte real quando nenhum dublê é injetado (o impasse de boot deixou de existir)", () => {
    const delivery = composeInvitationDelivery(CONFIG_EMAIL_COMPLETA);

    expect(delivery).toBeInstanceOf(SmtpInvitationDelivery);
    expect(delivery.mode).toBe("EMAIL");
  });

  it("usa o transporte injetado quando fornecido, sem construir o real", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const delivery = composeInvitationDelivery(CONFIG_EMAIL_COMPLETA, { send });

    await delivery.deliver({
      identityPublicId: "11111111-1111-4111-8111-111111111111",
      fullName: "Fulana de Teste",
      email: "fulana@exemplo.invalid",
      link: "https://ingressa.exemplo.invalid/convite#token-ficticio",
      expiresAt: new Date("2026-01-01T12:00:00.000Z")
    });

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("composeInvitationDelivery — configuração incompleta recusa o boot", () => {
  it.each([
    ["smtpHost", "INGRESSA_SMTP_HOST"],
    ["smtpUser", "INGRESSA_SMTP_USER"],
    ["smtpPassword", "INGRESSA_SMTP_PASSWORD"],
    ["smtpFrom", "INGRESSA_SMTP_FROM"]
  ])("lança citando o NOME da variável ausente quando %s está vazia", (campo, nomeEsperado) => {
    const config = { ...CONFIG_EMAIL_COMPLETA, [campo]: "" } as InvitationDeliveryConfig;

    expect(() => composeInvitationDelivery(config)).toThrow(InvitationDeliveryNotConfiguredError);
    expect(() => composeInvitationDelivery(config)).toThrow(nomeEsperado);
  });

  it("nunca cai silenciosamente para MANUAL_DEV quando o EMAIL está incompleto", () => {
    expect(() => composeInvitationDelivery({ ...CONFIG_EMAIL_COMPLETA, smtpHost: "" })).toThrow();
  });

  it("recusa remetente inválido citando o nome da variável, nunca o valor", () => {
    const valorInvalido = "remetente-sem-arroba";

    try {
      composeInvitationDelivery({ ...CONFIG_EMAIL_COMPLETA, smtpFrom: valorInvalido });
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect(error).toBeInstanceOf(InvitationDeliveryNotConfiguredError);
      expect((error as Error).message).toContain("INGRESSA_SMTP_FROM");
      expect((error as Error).message).not.toContain(valorInvalido);
    }
  });

  it("nunca inclui a senha de SMTP na mensagem de erro de configuração", () => {
    const senha = "senha-secreta-que-nunca-pode-vazar";

    try {
      composeInvitationDelivery({ ...CONFIG_EMAIL_COMPLETA, smtpPassword: senha, smtpHost: "" });
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect((error as Error).message).not.toContain(senha);
    }
  });
});

describe("isValidSmtpFrom — remetente configurável e validado", () => {
  it.each(["ingressa@exemplo.invalid", "PCTEC Ingressa <ingressa@exemplo.invalid>"])("aceita %s", (valor) => {
    expect(isValidSmtpFrom(valor)).toBe(true);
  });

  it.each(["", "   ", "sem-arroba", "sem@dominio", "<>"])("recusa %s", (valor) => {
    expect(isValidSmtpFrom(valor)).toBe(false);
  });
});

describe("resolveSmtpSecure — 465 implícito, 587 STARTTLS, sempre a partir de configuração", () => {
  it("deriva TLS implícito na porta 465 quando INGRESSA_SMTP_SECURE não é informada", () => {
    expect(resolveSmtpSecure(465, undefined)).toBe(true);
  });

  it("deriva STARTTLS na porta 587 quando INGRESSA_SMTP_SECURE não é informada", () => {
    expect(resolveSmtpSecure(587, undefined)).toBe(false);
  });

  it("respeita a configuração explícita acima da derivação por porta", () => {
    expect(resolveSmtpSecure(587, true)).toBe(true);
    expect(resolveSmtpSecure(465, false)).toBe(false);
  });
});

describe("NodemailerInvitationEmailTransport — envio e falha", () => {
  /**
   * Dublê mínimo do `Transporter` do nodemailer: só `sendMail` é usado.
   * O cast existe para não precisar montar a superfície inteira da
   * biblioteca num teste que nunca abre socket.
   */
  function transporteFalso(sendMail: ReturnType<typeof vi.fn>): never {
    return { sendMail } as unknown as never;
  }

  const MENSAGEM = {
    to: "fulana@exemplo.invalid",
    subject: "PCTEC Ingressa — defina sua senha de acesso",
    text: "corpo em texto",
    html: "<p>corpo em html</p>"
  };

  it("envia com sucesso usando o remetente configurado", async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: [MENSAGEM.to] });
    const transporte = new NodemailerInvitationEmailTransport(
      {
        host: "smtp.exemplo.invalid",
        port: 587,
        user: "usuario",
        password: "senha-de-teste",
        from: "PCTEC Ingressa <ingressa@exemplo.invalid>",
        secure: false,
        requireTls: true
      },
      transporteFalso(sendMail)
    );

    await transporte.send(MENSAGEM);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      from: "PCTEC Ingressa <ingressa@exemplo.invalid>",
      to: MENSAGEM.to,
      subject: MENSAGEM.subject
    });
  });

  it("converte falha do SMTP em erro tratável, repetível e sem detalhe do driver", async () => {
    const senha = "senha-de-teste-secreta";
    const linkComToken = "https://ingressa.exemplo.invalid/convite#token-secreto";
    const sendMail = vi
      .fn()
      .mockRejectedValue(new Error(`535 auth failed user=usuario pass=${senha} envelope=${linkComToken}`));

    const transporte = new NodemailerInvitationEmailTransport(
      {
        host: "smtp.exemplo.invalid",
        port: 587,
        user: "usuario",
        password: senha,
        from: "ingressa@exemplo.invalid",
        secure: false,
        requireTls: true
      },
      transporteFalso(sendMail)
    );

    await expect(transporte.send(MENSAGEM)).rejects.toBeInstanceOf(InvitationDeliveryFailedError);

    // A mensagem original do driver — com senha e token — nunca sobrevive.
    let capturado: Error | undefined;
    try {
      await transporte.send(MENSAGEM);
    } catch (erro) {
      capturado = erro as Error;
    }

    expect(capturado).toBeInstanceOf(InvitationDeliveryFailedError);
    expect(capturado!.message).not.toContain(senha);
    expect(capturado!.message).not.toContain(linkComToken);
    expect((capturado as unknown as { cause?: unknown }).cause).toBeUndefined();
  });

  it("o erro de envio é distinto do erro de configuração — a UI pede nova tentativa, não intervenção", () => {
    const transitorio = new InvitationDeliveryFailedError();

    expect(transitorio.code).toBe("INVITATION_DELIVERY_FAILED");
    expect(transitorio.code).not.toBe(new InvitationDeliveryNotConfiguredError("x").code);
  });
});

describe("gate de produção — MANUAL_DEV recusado, EMAIL exige TLS", () => {
  const BASE_PRODUCAO = {
    NODE_ENV: "production",
    SESSION_TTL_SECONDS: "28800",
    INVITATION_DELIVERY_MODE: "EMAIL"
  } as const;

  it("recusa MANUAL_DEV em produção, com mensagem que nomeia as variáveis a configurar", () => {
    expect(() => loadEnv({ ...BASE_PRODUCAO, INVITATION_DELIVERY_MODE: "MANUAL_DEV" })).toThrow(
      /INVITATION_DELIVERY_MODE=MANUAL_DEV/
    );
  });

  it("aceita EMAIL em produção — o boot deixou de ser impossível", () => {
    const env = loadEnv({ ...BASE_PRODUCAO });

    expect(env.INVITATION_DELIVERY_MODE).toBe("EMAIL");
    expect(env.NODE_ENV).toBe("production");
  });

  it("lê INGRESSA_SMTP_SECURE como booleano explícito, e undefined quando ausente", () => {
    expect(loadEnv({ ...BASE_PRODUCAO }).INGRESSA_SMTP_SECURE).toBeUndefined();
    expect(loadEnv({ ...BASE_PRODUCAO, INGRESSA_SMTP_SECURE: "true" }).INGRESSA_SMTP_SECURE).toBe(true);
    expect(loadEnv({ ...BASE_PRODUCAO, INGRESSA_SMTP_SECURE: "false" }).INGRESSA_SMTP_SECURE).toBe(false);
  });
});
