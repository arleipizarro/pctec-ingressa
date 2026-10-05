/**
 * "Esqueci minha senha" pela borda HTTP — `createApp` real, com os
 * serviços REAIS montados sobre o mundo em memória e o limitador real
 * sobre contadores em memória.
 */
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../../app/http/createApp.js";
import type { LoginService } from "../../security/application/LoginService.js";
import type { LogoutService } from "../../security/application/LogoutService.js";
import type { ValidateSessionService } from "../../security/application/ValidateSessionService.js";
import { AuthenticationFailedError } from "../../security/domain/errors/AuthenticationErrors.js";
import { LoginRateLimitPolicy } from "../../security/domain/LoginRateLimitPolicy.js";
import { InMemoryLoginRateLimitStore } from "../../security/tests/InMemoryLoginRateLimitStore.js";
import type { RequestPasswordResetService } from "../application/RequestPasswordResetService.js";
import { PASSWORD_RESET_NEUTRAL_MESSAGE } from "../http/passwordResetRoutes.js";
import { EMAIL_TITULAR, SENHA_NOVA, montarMundo } from "./passwordResetTestSupport.js";

const T0 = new Date("2026-03-01T12:00:00.000Z");

let servidor: Server | undefined;

afterEach(async () => {
  if (servidor !== undefined) {
    await new Promise<void>((resolve, reject) => servidor!.close((err) => (err ? reject(err) : resolve())));
    servidor = undefined;
  }
});

async function subir(
  opcoes: {
    mundo?: ReturnType<typeof montarMundo>;
    pedido?: RequestPasswordResetService;
    tetoIpEmail?: number;
  } = {}
) {
  const mundo = opcoes.mundo ?? montarMundo();
  const contadores = new InMemoryLoginRateLimitStore();
  const login = { chamadas: 0 };
  const app = createApp({
    loginService: {
      execute: async () => {
        login.chamadas += 1;
        throw new AuthenticationFailedError("INVALID_PASSWORD");
      }
    } as unknown as LoginService,
    logoutService: {} as unknown as LogoutService,
    validateSessionService: {} as unknown as ValidateSessionService,
    sessionCookieConfig: { secure: false },
    loginRateLimitStore: contadores,
    loginRateLimitPolicy: new LoginRateLimitPolicy({
      enabled: true,
      windowSeconds: 900,
      maxAttemptsPerIp: 60,
      maxAttemptsPerIpIdentifier: 2
    }),
    loginRateLimitClock: () => T0,
    loginRateLimitAuditEventRepository: mundo.auditoria,
    loginRateLimitClientIpResolver: () => "203.0.113.7",
    passwordResetRateLimitPolicy: new LoginRateLimitPolicy(
      { enabled: true, windowSeconds: 3_600, maxAttemptsPerIp: 50, maxAttemptsPerIpIdentifier: opcoes.tetoIpEmail ?? 5 },
      "password-reset"
    ),
    requestPasswordResetService: opcoes.pedido ?? mundo.pedido,
    completePasswordResetService: mundo.conclusao
  });
  servidor = app.listen(0);
  await new Promise<void>((resolve) => servidor!.once("listening", resolve));
  const endereco = servidor.address();
  if (endereco === null || typeof endereco === "string") {
    throw new Error("endereço inesperado");
  }
  const base = `http://127.0.0.1:${endereco.port}`;
  const post = (caminho: string, corpo: unknown): Promise<Response> =>
    fetch(`${base}${caminho}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo)
    });
  return { mundo, post, login };
}

/** O pedido roda DEPOIS da resposta — espera o efeito em vez de supor um tempo. */
async function aguardar(condicao: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condicao(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condicao()).toBe(true);
}

describe("POST /api/v1/password-reset/request — resposta neutra", () => {
  it("e-mail cadastrado e e-mail inexistente recebem exatamente a mesma resposta", async () => {
    const { post, mundo } = await subir();

    const cadastrado = await post("/api/v1/password-reset/request", { email: EMAIL_TITULAR });
    const inexistente = await post("/api/v1/password-reset/request", { email: "ninguem@example.invalid" });

    expect(cadastrado.status).toBe(202);
    expect(inexistente.status).toBe(202);
    const corpoCadastrado = await cadastrado.json();
    expect(corpoCadastrado).toEqual({ message: PASSWORD_RESET_NEUTRAL_MESSAGE });
    expect(await inexistente.json()).toEqual(corpoCadastrado);
    expect(PASSWORD_RESET_NEUTRAL_MESSAGE).toBe(
      "Se este e-mail estiver cadastrado, enviaremos instruções para redefinir sua senha."
    );

    await aguardar(() => mundo.auditoria.doTipo("password-reset.requested").length === 2);
    expect(mundo.entrega.enviados).toHaveLength(1);
  });

  it("responde SEM esperar o processamento — o tempo não revela se o e-mail existe", async () => {
    let liberar: () => void = () => undefined;
    const pedidoQueDemora = {
      execute: () =>
        new Promise((resolve) => {
          liberar = () => resolve({ outcome: "ISSUED", delivered: true });
        })
    } as unknown as RequestPasswordResetService;
    const { post } = await subir({ pedido: pedidoQueDemora });

    const resposta = await post("/api/v1/password-reset/request", { email: EMAIL_TITULAR });

    expect(resposta.status).toBe(202);
    liberar();
  });

  it("corpo malformado também recebe a resposta neutra", async () => {
    const { post } = await subir();
    const resposta = await post("/api/v1/password-reset/request", { email: 42 });
    expect(resposta.status).toBe(202);
    expect(await resposta.json()).toEqual({ message: PASSWORD_RESET_NEUTRAL_MESSAGE });
  });

  it("login desabilitado: mesma resposta, nenhum e-mail, tentativa registrada", async () => {
    const { post, mundo } = await subir({ mundo: montarMundo({ loginEnabled: false }) });

    const resposta = await post("/api/v1/password-reset/request", { email: EMAIL_TITULAR });

    expect(resposta.status).toBe(202);
    expect(await resposta.json()).toEqual({ message: PASSWORD_RESET_NEUTRAL_MESSAGE });
    await aguardar(() => mundo.auditoria.doTipo("password-reset.requested").length === 1);
    expect(mundo.auditoria.doTipo("password-reset.requested")[0]!.payload["outcome"]).toBe("IGNORED_LOGIN_DISABLED");
    expect(mundo.entrega.enviados).toHaveLength(0);
    expect(mundo.tokens.todos).toHaveLength(0);
  });
});

describe("POST /api/v1/password-reset — limitação de tentativas", () => {
  it("estoura por IP+e-mail com código próprio e mensagem que não diz se o e-mail existe", async () => {
    const { post } = await subir({ tetoIpEmail: 2 });
    await post("/api/v1/password-reset/request", { email: "qualquer@example.invalid" });
    await post("/api/v1/password-reset/request", { email: "qualquer@example.invalid" });

    const barrada = await post("/api/v1/password-reset/request", { email: "qualquer@example.invalid" });

    expect(barrada.status).toBe(429);
    expect(barrada.headers.get("retry-after")).not.toBeNull();
    const corpo = (await barrada.json()) as { error: { code: string; message: string } };
    expect(corpo.error.code).toBe("PASSWORD_RESET_RATE_LIMITED");
    expect(corpo.error.message).not.toMatch(/cadastrad|inexistente|não existe/i);
  });

  it("os contadores NÃO são os do login: estourar a redefinição não tranca o login", async () => {
    const { post, login } = await subir({ tetoIpEmail: 1 });
    await post("/api/v1/password-reset/request", { email: EMAIL_TITULAR });
    expect((await post("/api/v1/password-reset/request", { email: EMAIL_TITULAR })).status).toBe(429);

    const tentativaDeLogin = await post("/api/v1/sessions", { email: EMAIL_TITULAR, password: "senha-qualquer-123" });

    expect(tentativaDeLogin.status).toBe(401);
    expect(login.chamadas).toBe(1);
  });
});

describe("fluxo completo pela HTTP", () => {
  it("pedir → abrir o link → trocar a senha → o mesmo link não funciona de novo", async () => {
    const { post, mundo } = await subir();

    await post("/api/v1/password-reset/request", { email: EMAIL_TITULAR });
    await aguardar(() => mundo.entrega.enviados.length === 1);
    const token = mundo.entrega.ultimoToken();

    const previa = await post("/api/v1/password-reset/preview", { token });
    expect(previa.status).toBe(200);
    expect(Object.keys((await previa.json()) as object)).toEqual(["expiresAt"]);

    const troca = await post("/api/v1/password-reset/confirm", {
      token,
      password: SENHA_NOVA,
      passwordConfirmation: SENHA_NOVA
    });
    expect(troca.status).toBe(200);
    expect(await troca.json()).toEqual({ passwordReset: true });
    // Trocar a senha não autentica: o próximo passo é o login.
    expect(troca.headers.get("set-cookie")).toBeNull();

    const reuso = await post("/api/v1/password-reset/confirm", {
      token,
      password: SENHA_NOVA,
      passwordConfirmation: SENHA_NOVA
    });
    expect(reuso.status).toBe(401);
    expect(((await reuso.json()) as { error: { code: string } }).error.code).toBe("PASSWORD_RESET_NOT_USABLE");
  });

  it("link expirado: preview e troca recusados com o mesmo código", async () => {
    const { post, mundo } = await subir();
    await post("/api/v1/password-reset/request", { email: EMAIL_TITULAR });
    await aguardar(() => mundo.entrega.enviados.length === 1);
    const token = mundo.entrega.ultimoToken();
    mundo.avancar(31 * 60);

    const previa = await post("/api/v1/password-reset/preview", { token });
    const troca = await post("/api/v1/password-reset/confirm", {
      token,
      password: SENHA_NOVA,
      passwordConfirmation: SENHA_NOVA
    });

    for (const resposta of [previa, troca]) {
      expect(resposta.status).toBe(401);
      expect(((await resposta.json()) as { error: { code: string } }).error.code).toBe("PASSWORD_RESET_NOT_USABLE");
    }
  });

  it("senha fora da política: 422, e o link continua valendo", async () => {
    const { post, mundo } = await subir();
    await post("/api/v1/password-reset/request", { email: EMAIL_TITULAR });
    await aguardar(() => mundo.entrega.enviados.length === 1);
    const token = mundo.entrega.ultimoToken();

    const curta = await post("/api/v1/password-reset/confirm", { token, password: "curta", passwordConfirmation: "curta" });

    expect(curta.status).toBe(422);
    expect(((await curta.json()) as { error: { code: string } }).error.code).toBe(
      "CREDENTIAL_PASSWORD_POLICY_VIOLATION"
    );
    expect((await post("/api/v1/password-reset/preview", { token })).status).toBe(200);
  });
});
