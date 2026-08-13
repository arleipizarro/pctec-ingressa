import { describe, expect, it } from "vitest";

import { loadEnv } from "../env.js";

describe("loadEnv — HOST/PORT (v0.4.1 Runtime Bootstrap)", () => {
  it("usa 127.0.0.1:3011 como default quando HOST/PORT não estão definidos", () => {
    const env = loadEnv({});

    expect(env.HOST).toBe("127.0.0.1");
    expect(env.PORT).toBe(3011);
  });

  it("nunca assume 0.0.0.0 por omissão — bind restrito ao loopback por padrão", () => {
    const env = loadEnv({});

    expect(env.HOST).not.toBe("0.0.0.0");
  });

  it("lê HOST/PORT de process.env quando fornecidos", () => {
    const env = loadEnv({ HOST: "10.0.0.5", PORT: "8080" });

    expect(env.HOST).toBe("10.0.0.5");
    expect(env.PORT).toBe(8080);
  });

  it("PORT é coagido para número e precisa ser inteiro positivo", () => {
    expect(() => loadEnv({ PORT: "0" })).toThrow();
    expect(() => loadEnv({ PORT: "-1" })).toThrow();
    expect(() => loadEnv({ PORT: "abc" })).toThrow();
  });

  it("HOST vazio é rejeitado (min(1))", () => {
    expect(() => loadEnv({ HOST: "" })).toThrow();
  });

  it("MIGRATIONS_ALLOW_DESTRUCTIVE tem default false (nunca destrutivo por omissão)", () => {
    const env = loadEnv({});
    expect(env.MIGRATIONS_ALLOW_DESTRUCTIVE).toBe(false);
  });

  it("MIGRATIONS_ALLOW_DESTRUCTIVE=true (case-insensitive) habilita o gate", () => {
    expect(loadEnv({ MIGRATIONS_ALLOW_DESTRUCTIVE: "true" }).MIGRATIONS_ALLOW_DESTRUCTIVE).toBe(true);
    expect(loadEnv({ MIGRATIONS_ALLOW_DESTRUCTIVE: "TRUE" }).MIGRATIONS_ALLOW_DESTRUCTIVE).toBe(true);
    expect(loadEnv({ MIGRATIONS_ALLOW_DESTRUCTIVE: "false" }).MIGRATIONS_ALLOW_DESTRUCTIVE).toBe(false);
    expect(loadEnv({ MIGRATIONS_ALLOW_DESTRUCTIVE: "qualquer-outra-coisa" }).MIGRATIONS_ALLOW_DESTRUCTIVE).toBe(false);
  });
});

describe("loadEnv — SESSION_COOKIE_SECURE (v0.6.0, Fase D, revisão crítica item 7)", () => {
  it("default é true quando ausente (fallback seguro, nunca inseguro por omissão)", () => {
    const env = loadEnv({ NODE_ENV: "development" });
    expect(env.SESSION_COOKIE_SECURE).toBe(true);
  });

  it("development/test aceitam SESSION_COOKIE_SECURE=false explicitamente (útil para HTTP local sem TLS)", () => {
    expect(loadEnv({ NODE_ENV: "development", SESSION_COOKIE_SECURE: "false" }).SESSION_COOKIE_SECURE).toBe(false);
    expect(loadEnv({ NODE_ENV: "test", SESSION_COOKIE_SECURE: "false" }).SESSION_COOKIE_SECURE).toBe(false);
  });

  it("produção com SESSION_COOKIE_SECURE=false FALHA no carregamento — nunca aceito", () => {
    expect(() =>
      loadEnv({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "false", SESSION_TTL_SECONDS: "3600" })
    ).toThrow(/SESSION_COOKIE_SECURE/);
  });

  it("produção com SESSION_COOKIE_SECURE ausente (assume default true) carrega normalmente — omissão nunca é insegura", () => {
    const env = loadEnv({ NODE_ENV: "production", SESSION_TTL_SECONDS: "3600" });
    expect(env.SESSION_COOKIE_SECURE).toBe(true);
  });

  it("produção com SESSION_COOKIE_SECURE=true explícito carrega normalmente", () => {
    const env = loadEnv({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "true", SESSION_TTL_SECONDS: "3600" });
    expect(env.SESSION_COOKIE_SECURE).toBe(true);
  });
});

describe("loadEnv — SESSION_TTL_SECONDS (v0.6.0, Fase D, revisão crítica item 10)", () => {
  it("default é 28800 (8h) quando ausente em development/test — documentado como valor operacional, não regra de domínio", () => {
    expect(loadEnv({ NODE_ENV: "development" }).SESSION_TTL_SECONDS).toBe(28800);
    expect(loadEnv({ NODE_ENV: "test" }).SESSION_TTL_SECONDS).toBe(28800);
  });

  it("precisa ser inteiro positivo — zero/negativo/não numérico são rejeitados", () => {
    expect(() => loadEnv({ SESSION_TTL_SECONDS: "0" })).toThrow();
    expect(() => loadEnv({ SESSION_TTL_SECONDS: "-100" })).toThrow();
    expect(() => loadEnv({ SESSION_TTL_SECONDS: "abc" })).toThrow();
    expect(() => loadEnv({ SESSION_TTL_SECONDS: "3600.5" })).toThrow();
  });

  it("tem limite superior razoável (30 dias) — valores absurdamente altos são rejeitados", () => {
    expect(() => loadEnv({ SESSION_TTL_SECONDS: "2592001" })).toThrow();
    expect(loadEnv({ SESSION_TTL_SECONDS: "2592000" }).SESSION_TTL_SECONDS).toBe(2_592_000);
  });

  it("produção SEM SESSION_TTL_SECONDS explícito FALHA no carregamento — nunca herda o default de development/test silenciosamente", () => {
    expect(() => loadEnv({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "true" })).toThrow(
      /SESSION_TTL_SECONDS/
    );
  });

  it("produção COM SESSION_TTL_SECONDS explícito carrega normalmente, mesmo que o valor numérico coincida com o default", () => {
    const env = loadEnv({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "true", SESSION_TTL_SECONDS: "28800" });
    expect(env.SESSION_TTL_SECONDS).toBe(28800);
  });

  it("development/test NÃO exigem SESSION_TTL_SECONDS explícito — só produção", () => {
    expect(() => loadEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(() => loadEnv({ NODE_ENV: "test" })).not.toThrow();
  });
});

describe("loadEnv — INGRESSA_PORTAL_SERVICE_CREDENTIAL (P1A.1, v0.7.x — revisão pré-commit)", () => {
  it("1) loadEnv() SEM INGRESSA_PORTAL_SERVICE_CREDENTIAL continua válido — nunca falha o carregamento por causa dela, em nenhum NODE_ENV, inclusive production", () => {
    expect(() => loadEnv({})).not.toThrow();
    expect(() => loadEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(() => loadEnv({ NODE_ENV: "test" })).not.toThrow();
    expect(() => loadEnv({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "true", SESSION_TTL_SECONDS: "28800" })).not.toThrow();
  });

  it("default é string vazia quando ausente — nunca um segredo funcional por omissão, mas também nunca um valor que impeça o boot", () => {
    const env = loadEnv({});
    expect(env.INGRESSA_PORTAL_SERVICE_CREDENTIAL).toBe("");
  });

  it("lê o valor real quando presente", () => {
    const env = loadEnv({ INGRESSA_PORTAL_SERVICE_CREDENTIAL: "segredo-real-de-teste" });
    expect(env.INGRESSA_PORTAL_SERVICE_CREDENTIAL).toBe("segredo-real-de-teste");
  });

  it("string vazia explícita também é aceita sem erro (mesmo resultado que ausência)", () => {
    expect(() => loadEnv({ INGRESSA_PORTAL_SERVICE_CREDENTIAL: "" })).not.toThrow();
    expect(loadEnv({ INGRESSA_PORTAL_SERVICE_CREDENTIAL: "" }).INGRESSA_PORTAL_SERVICE_CREDENTIAL).toBe("");
  });
});
