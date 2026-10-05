import { describe, expect, it } from "vitest";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import { CredentialPasswordPolicyViolationError } from "../../security/domain/value-objects/PlainPassword.js";
import { PasswordResetNotUsableError } from "../domain/errors/PasswordResetErrors.js";
import { EMAIL_TITULAR, SENHA_NOVA, SENHA_NOVA_PHC, TITULAR, montarMundo } from "./passwordResetTestSupport.js";

async function pedirLink(mundo: ReturnType<typeof montarMundo>): Promise<string> {
  await mundo.pedido.execute({ email: EMAIL_TITULAR });
  return mundo.entrega.ultimoToken();
}

function trocar(mundo: ReturnType<typeof montarMundo>, token: string, senha = SENHA_NOVA, confirmacao = senha) {
  return mundo.conclusao.execute({ token, password: senha, passwordConfirmation: confirmacao });
}

describe("conclusão — sucesso", () => {
  it("troca o hash da credencial EXISTENTE, marca o token como usado e encerra as sessões", async () => {
    const mundo = montarMundo();
    const token = await pedirLink(mundo);

    const resultado = await trocar(mundo, token);

    expect(resultado).toEqual({ identityPublicId: TITULAR, revokedSessions: 2 });
    expect(mundo.credentials.credenciais).toHaveLength(1);
    expect(mundo.credentials.credenciais[0]!.getPasswordHash().toString()).toBe(SENHA_NOVA_PHC);
    expect(mundo.credentials.atualizacoes).toBe(1);
    expect(mundo.tokens.todos[0]!.getStatus()).toBe("CONSUMED");
    expect(mundo.sessions.sessoes.every((s) => s.getStatus() === "REVOKED")).toBe(true);
    expect(mundo.sessions.sessoes[0]!.getRevocationReason()).toBe("PASSWORD_RESET");
  });

  it("a senha passa pelo hasher (nunca chega crua ao repositório)", async () => {
    const mundo = montarMundo();
    await trocar(mundo, await pedirLink(mundo));
    expect(mundo.hashes).toEqual([SENHA_NOVA]);
  });

  it("audita troca de credencial, sessões revogadas e conclusão — sem senha nem token", async () => {
    const mundo = montarMundo();
    const token = await pedirLink(mundo);
    await trocar(mundo, token);

    expect(mundo.auditoria.tipos()).toEqual(
      expect.arrayContaining(["credential.changed", "session.revoked", "password-reset.completed"])
    );
    const [mudanca] = mundo.auditoria.doTipo("credential.changed");
    expect(mudanca!.actorPublicId).toBe(TITULAR);
    expect(mudanca!.payload["reasonCode"]).toBe("SELF_SERVICE_PASSWORD_RESET");
    const [conclusao] = mundo.auditoria.doTipo("password-reset.completed");
    expect(conclusao!.payload["revokedSessions"]).toBe(2);

    const serializado = JSON.stringify(mundo.auditoria.eventos);
    expect(serializado).not.toContain(SENHA_NOVA);
    expect(serializado).not.toContain(token);
    expect(serializado).not.toContain(SENHA_NOVA_PHC);
  });

  it("o preview NÃO gasta o link e devolve só a validade", async () => {
    const mundo = montarMundo();
    const token = await pedirLink(mundo);

    const previa = await mundo.conclusao.preview(token);
    await mundo.conclusao.preview(token);

    expect(Object.keys(previa)).toEqual(["expiresAt"]);
    expect(mundo.tokens.todos[0]!.getStatus()).toBe("PENDING");
    await expect(trocar(mundo, token)).resolves.toBeDefined();
  });
});

describe("conclusão — link que não vale", () => {
  it("token reutilizado: a segunda troca é recusada e a senha não muda de novo", async () => {
    const mundo = montarMundo();
    const token = await pedirLink(mundo);
    await trocar(mundo, token);

    await expect(trocar(mundo, token, "outra-senha-sintetica-longa")).rejects.toBeInstanceOf(
      PasswordResetNotUsableError
    );
    await expect(mundo.conclusao.preview(token)).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    expect(mundo.credentials.atualizacoes).toBe(1);
  });

  it("token expirado: recusado no preview e na troca", async () => {
    const mundo = montarMundo();
    const token = await pedirLink(mundo);
    mundo.avancar(30 * 60);

    await expect(mundo.conclusao.preview(token)).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    await expect(trocar(mundo, token)).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    expect(mundo.credentials.atualizacoes).toBe(0);
    expect(mundo.sessions.sessoes.every((s) => s.getStatus() === "ACTIVE")).toBe(true);
  });

  it("token substituído por um pedido mais novo: recusado", async () => {
    const mundo = montarMundo();
    const antigo = await pedirLink(mundo);
    const novo = await pedirLink(mundo);

    await expect(trocar(mundo, antigo)).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    await expect(trocar(mundo, novo)).resolves.toBeDefined();
  });

  it("token inventado ou vazio: recusado", async () => {
    const mundo = montarMundo();
    await expect(trocar(mundo, "token-que-nunca-existiu")).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    await expect(trocar(mundo, "")).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    await expect(mundo.conclusao.preview("")).rejects.toBeInstanceOf(PasswordResetNotUsableError);
  });

  it("todas as causas respondem a MESMA mensagem — não conta se o link um dia valeu", async () => {
    const mundo = montarMundo();
    const token = await pedirLink(mundo);
    await trocar(mundo, token);
    const reusado = await trocar(mundo, token).catch((e: Error) => e.message);
    const inventado = await trocar(mundo, "inventado").catch((e: Error) => e.message);
    expect(reusado).toBe(inventado);
  });

  it("login desabilitado DEPOIS do pedido: o link deixa de valer e a senha não muda", async () => {
    const mundo = montarMundo();
    const token = await pedirLink(mundo);
    mundo.identities.identidades[0]!.disableLogin({
      actor: ActorPublicId.required("66231e51-66fb-466d-af4f-ac7b925ca9ec"),
      expectedVersion: mundo.identities.identidades[0]!.getVersion(),
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    });

    await expect(mundo.conclusao.preview(token)).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    await expect(trocar(mundo, token)).rejects.toBeInstanceOf(PasswordResetNotUsableError);
    expect(mundo.credentials.atualizacoes).toBe(0);
  });
});

describe("conclusão — política de senha", () => {
  it("senha curta é recusada ANTES de gastar o link — a pessoa corrige e tenta de novo", async () => {
    const mundo = montarMundo();
    const token = await pedirLink(mundo);

    await expect(trocar(mundo, token, "curta")).rejects.toBeInstanceOf(CredentialPasswordPolicyViolationError);
    expect(mundo.tokens.todos[0]!.getStatus()).toBe("PENDING");
    await expect(trocar(mundo, token)).resolves.toBeDefined();
  });

  it("confirmação diferente é recusada sem gastar o link", async () => {
    const mundo = montarMundo();
    const token = await pedirLink(mundo);

    await expect(trocar(mundo, token, SENHA_NOVA, `${SENHA_NOVA}-x`)).rejects.toBeInstanceOf(
      CredentialPasswordPolicyViolationError
    );
    expect(mundo.tokens.todos[0]!.getStatus()).toBe("PENDING");
  });
});
