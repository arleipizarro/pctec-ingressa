import { describe, expect, it } from "vitest";
import {
  deriveCodeChallengeS256,
  isValidCodeChallenge,
  isValidCodeVerifier,
  PKCE_METHOD_S256,
  verifyCodeChallengeS256
} from "../infrastructure/token/pkce.js";

const VERIFIER = "abcdefghijklmnopqrstuvwxyz0123456789-._~ABCDEF";

describe("PKCE S256", () => {
  it("só admite S256 como método", () => {
    expect(PKCE_METHOD_S256).toBe("S256");
  });

  it("verifier fora de 43..128 caracteres é recusado", () => {
    expect(isValidCodeVerifier("curto")).toBe(false);
    expect(isValidCodeVerifier("a".repeat(42))).toBe(false);
    expect(isValidCodeVerifier("a".repeat(43))).toBe(true);
    expect(isValidCodeVerifier("a".repeat(129))).toBe(false);
  });

  it("verifier com caractere fora do alfabeto unreserved é recusado", () => {
    expect(isValidCodeVerifier(`${"a".repeat(42)}+`)).toBe(false);
    expect(isValidCodeVerifier(`${"a".repeat(42)}/`)).toBe(false);
  });

  it("challenge derivado é base64url de 43 caracteres", () => {
    const challenge = deriveCodeChallengeS256(VERIFIER);
    expect(challenge).toHaveLength(43);
    expect(isValidCodeChallenge(challenge)).toBe(true);
    expect(challenge).not.toContain("=");
  });

  it("o verifier correto satisfaz o desafio", () => {
    expect(verifyCodeChallengeS256(VERIFIER, deriveCodeChallengeS256(VERIFIER))).toBe(true);
  });

  it("um verifier diferente NUNCA satisfaz o desafio", () => {
    const challenge = deriveCodeChallengeS256(VERIFIER);
    expect(verifyCodeChallengeS256(`${VERIFIER.slice(0, -1)}Z`, challenge)).toBe(false);
  });

  it("o próprio challenge apresentado como verifier não passa — isto é o que 'plain' permitiria", () => {
    const challenge = deriveCodeChallengeS256(VERIFIER);
    expect(verifyCodeChallengeS256(challenge, challenge)).toBe(false);
  });
});
