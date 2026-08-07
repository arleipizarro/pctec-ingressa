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
});
