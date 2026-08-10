import { describe, it, expect } from "vitest";
import { hashSessionToken } from "../infrastructure/token/hashSessionToken.js";
import { CryptoSessionTokenGenerator, SESSION_TOKEN_BYTE_LENGTH } from "../infrastructure/token/SessionTokenGenerator.js";

describe("hashSessionToken", () => {
  it("produz um hex de 64 caracteres (SHA-256)", () => {
    const hash = hashSessionToken("qualquer-token-de-exemplo");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("é determinístico — mesma entrada sempre produz a mesma saída", () => {
    const token = "token-fixo-para-teste-determinismo";
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("entradas diferentes produzem hashes diferentes", () => {
    expect(hashSessionToken("token-a")).not.toBe(hashSessionToken("token-b"));
  });

  it("nunca retorna o próprio token de entrada", () => {
    const token = "meu-token-secreto-123456";
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe("CryptoSessionTokenGenerator", () => {
  it("gera um token com 256 bits de entropia (32 bytes → base64url)", () => {
    expect(SESSION_TOKEN_BYTE_LENGTH).toBe(32);
  });

  it("gera tokens diferentes a cada chamada", () => {
    const generator = new CryptoSessionTokenGenerator();
    const tokenA = generator.generate();
    const tokenB = generator.generate();
    expect(tokenA).not.toBe(tokenB);
  });

  it("o token gerado é seguro para uso em cookie/URL — nunca contém '+', '/' ou '=' (base64url sem padding)", () => {
    const generator = new CryptoSessionTokenGenerator();
    for (let i = 0; i < 20; i += 1) {
      const token = generator.generate();
      expect(token).not.toContain("+");
      expect(token).not.toContain("/");
      expect(token).not.toContain("=");
    }
  });

  it("32 bytes em base64url produzem uma string de 43 caracteres", () => {
    const generator = new CryptoSessionTokenGenerator();
    const token = generator.generate();
    expect(token).toHaveLength(43);
  });
});
