import { createHash, timingSafeEqual } from "node:crypto";

/**
 * PKCE (RFC 7636) — somente `S256`. `plain` é recusado por construção:
 * não existe nenhum caminho de código que o aceite, e o próprio ENUM da
 * coluna `code_challenge_method` (migration 0022) só admite `S256`.
 *
 * `plain` transportaria o verifier em claro no redirect, o que anularia
 * o propósito do mecanismo — o desafio serve exatamente para que o valor
 * que trafega pelo navegador não seja o mesmo que prova a posse.
 */
export const PKCE_METHOD_S256 = "S256" as const;

/**
 * `code_verifier` — RFC 7636 §4.1: 43 a 128 caracteres do alfabeto
 * `unreserved` (`[A-Za-z0-9-._~]`). O limite inferior de 43 é o que
 * garante os 256 bits mínimos de entropia; aceitar menos que isso
 * tornaria o desafio adivinhável.
 */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/** `code_challenge` S256 é sempre base64url de 32 bytes — 43 caracteres, sem padding. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeVerifier(value: string): boolean {
  return VERIFIER_PATTERN.test(value);
}

export function isValidCodeChallenge(value: string): boolean {
  return CHALLENGE_PATTERN.test(value);
}

export function deriveCodeChallengeS256(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

/**
 * Comparação em tempo constante entre o desafio derivado do verifier
 * apresentado e o desafio registrado na emissão.
 *
 * Ambos os lados passam pelo digest antes da comparação, então os
 * buffers têm sempre o mesmo tamanho e `timingSafeEqual` nunca lança —
 * mesma técnica já usada em `requireServiceCredential.ts`. Nunca `===`
 * sobre valor que participa de decisão de autenticação.
 */
export function verifyCodeChallengeS256(codeVerifier: string, expectedChallenge: string): boolean {
  if (!isValidCodeVerifier(codeVerifier) || !isValidCodeChallenge(expectedChallenge)) {
    return false;
  }
  const derived = createHash("sha256").update(codeVerifier, "ascii").digest();
  const expected = Buffer.from(expectedChallenge, "base64url");
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
