import { describe, expect, it } from "vitest";
import { PASSWORD_RESET_FORM_AGGREGATE_PUBLIC_ID } from "../domain/events/PasswordResetDomainEvents.js";
import { hashPasswordResetToken } from "../infrastructure/token/passwordResetTokenHash.js";
import { BASE, EMAIL_TITULAR, T0, TITULAR, montarMundo } from "./passwordResetTestSupport.js";

describe("pedido de redefinição — titular elegível", () => {
  it("emite UM pedido, guarda só o hash do token e entrega o link com o token no fragmento", async () => {
    const mundo = montarMundo();
    const resultado = await mundo.pedido.execute({ email: EMAIL_TITULAR });

    expect(resultado).toEqual({ outcome: "ISSUED", delivered: true });
    expect(mundo.tokens.todos).toHaveLength(1);
    expect(mundo.entrega.enviados).toHaveLength(1);

    const enviado = mundo.entrega.enviados[0]!;
    const token = mundo.entrega.ultimoToken();
    expect(enviado.email).toBe(EMAIL_TITULAR);
    expect(enviado.link).toBe(`${BASE}/redefinir-senha#${token}`);
    expect(mundo.tokens.todos[0]!.getTokenHash()).toBe(hashPasswordResetToken(token));
    expect(mundo.tokens.todos[0]!.getTokenHash()).not.toContain(token);
  });

  it("expira em 30 minutos por padrão", async () => {
    const mundo = montarMundo();
    await mundo.pedido.execute({ email: EMAIL_TITULAR });
    expect(mundo.tokens.todos[0]!.getExpiresAt().getTime() - T0.getTime()).toBe(30 * 60 * 1000);
  });

  it("nunca passa de 60 minutos, mesmo configurado para mais", async () => {
    const mundo = montarMundo({ ttlSeconds: 86_400 });
    await mundo.pedido.execute({ email: EMAIL_TITULAR });
    expect(mundo.tokens.todos[0]!.getExpiresAt().getTime() - T0.getTime()).toBe(60 * 60 * 1000);
  });

  it("normaliza o e-mail como o login (espaços e maiúsculas)", async () => {
    const mundo = montarMundo();
    const resultado = await mundo.pedido.execute({ email: `  ${EMAIL_TITULAR.toUpperCase()} ` });
    expect(resultado.outcome).toBe("ISSUED");
  });

  it("revoga o pedido anterior ainda aberto — no máximo um link válido por pessoa", async () => {
    const mundo = montarMundo();
    await mundo.pedido.execute({ email: EMAIL_TITULAR });
    await mundo.pedido.execute({ email: EMAIL_TITULAR });

    const [primeiro, segundo] = mundo.tokens.todos;
    expect(primeiro!.getStatus()).toBe("REVOKED");
    expect(primeiro!.getRevocationReason()).toBe("SUPERSEDED");
    expect(segundo!.getStatus()).toBe("PENDING");
    const emitidos = mundo.auditoria.doTipo("password-reset.requested");
    expect(emitidos.at(-1)!.payload["supersededCount"]).toBe(1);
  });

  it("audita o pedido sem e-mail, sem token, sem hash e sem link", async () => {
    const mundo = montarMundo();
    await mundo.pedido.execute({ email: EMAIL_TITULAR });

    const [evento] = mundo.auditoria.doTipo("password-reset.requested");
    expect(evento!.aggregatePublicId).toBe(TITULAR);
    expect(evento!.actorPublicId).toBe("SYSTEM");
    expect(evento!.payload["outcome"]).toBe("ISSUED");

    const serializado = JSON.stringify(mundo.auditoria.eventos);
    expect(serializado).not.toContain(EMAIL_TITULAR);
    expect(serializado).not.toContain(mundo.entrega.ultimoToken());
    expect(serializado).not.toContain(mundo.tokens.todos[0]!.getTokenHash());
    expect(serializado).not.toContain("redefinir-senha");
  });

  it("teto por titular: o quarto pedido na mesma hora não gera e-mail", async () => {
    const mundo = montarMundo();
    for (let i = 0; i < 3; i += 1) {
      await mundo.pedido.execute({ email: EMAIL_TITULAR });
    }
    const quarto = await mundo.pedido.execute({ email: EMAIL_TITULAR });

    expect(quarto.outcome).toBe("THROTTLED");
    expect(mundo.entrega.enviados).toHaveLength(3);
    expect(mundo.auditoria.doTipo("password-reset.requested").at(-1)!.payload["outcome"]).toBe("THROTTLED");
  });

  it("o teto por titular reabre depois da janela", async () => {
    const mundo = montarMundo();
    for (let i = 0; i < 3; i += 1) {
      await mundo.pedido.execute({ email: EMAIL_TITULAR });
    }
    mundo.avancar(3_601);
    expect((await mundo.pedido.execute({ email: EMAIL_TITULAR })).outcome).toBe("ISSUED");
  });

  it("falha do SMTP não escapa nem é registrada com o erro do driver", async () => {
    const mundo = montarMundo();
    mundo.entrega.falhar = true;

    const resultado = await mundo.pedido.execute({ email: EMAIL_TITULAR });

    expect(resultado).toEqual({ outcome: "ISSUED", delivered: false });
    const [falha] = mundo.auditoria.doTipo("password-reset.delivery-failed");
    expect(falha!.payload["identityPublicId"]).toBe(TITULAR);
    expect(JSON.stringify(mundo.auditoria.eventos)).not.toContain("smtp recusou");
  });
});

describe("pedido de redefinição — casos ignorados (resposta neutra, nada emitido)", () => {
  it("e-mail inexistente: nenhum pedido, nenhum e-mail, auditoria sem o endereço", async () => {
    const mundo = montarMundo();
    const resultado = await mundo.pedido.execute({ email: "ninguem@example.invalid" });

    expect(resultado).toEqual({ outcome: "IGNORED_UNKNOWN_EMAIL", delivered: false });
    expect(mundo.tokens.todos).toHaveLength(0);
    expect(mundo.entrega.enviados).toHaveLength(0);

    const [evento] = mundo.auditoria.doTipo("password-reset.requested");
    expect(evento!.aggregatePublicId).toBe(PASSWORD_RESET_FORM_AGGREGATE_PUBLIC_ID);
    expect(evento!.payload).toEqual({ outcome: "IGNORED_UNKNOWN_EMAIL" });
    expect(JSON.stringify(mundo.auditoria.eventos)).not.toContain("ninguem@");
  });

  it("e-mail vazio segue o mesmo caminho do inexistente", async () => {
    const mundo = montarMundo();
    expect((await mundo.pedido.execute({ email: "   " })).outcome).toBe("IGNORED_UNKNOWN_EMAIL");
  });

  it("login desabilitado: não redefine, mas REGISTRA a tentativa para o ADMIN", async () => {
    const mundo = montarMundo({ loginEnabled: false });
    const resultado = await mundo.pedido.execute({ email: EMAIL_TITULAR });

    expect(resultado.outcome).toBe("IGNORED_LOGIN_DISABLED");
    expect(mundo.tokens.todos).toHaveLength(0);
    expect(mundo.entrega.enviados).toHaveLength(0);
    const [evento] = mundo.auditoria.doTipo("password-reset.requested");
    expect(evento!.aggregatePublicId).toBe(TITULAR);
    expect(evento!.payload).toEqual({ outcome: "IGNORED_LOGIN_DISABLED", identityPublicId: TITULAR });
  });

  it.each(["PENDING", "BLOCKED", "INACTIVE"])("identidade %s: ignorada", async (status) => {
    const mundo = montarMundo({ status, loginEnabled: false });
    const resultado = await mundo.pedido.execute({ email: EMAIL_TITULAR });

    expect(resultado.outcome).toBe("IGNORED_IDENTITY_NOT_ACTIVE");
    expect(mundo.entrega.enviados).toHaveLength(0);
  });

  it("sem credencial (nunca definiu senha): ignorada — o caminho é o convite", async () => {
    const mundo = montarMundo({ semCredencial: true });
    expect((await mundo.pedido.execute({ email: EMAIL_TITULAR })).outcome).toBe("IGNORED_NO_CREDENTIAL");
    expect(mundo.entrega.enviados).toHaveLength(0);
  });
});
