import { createHash } from "node:crypto";

/**
 * Hash do código de autorização — mesma decisão já registrada para o
 * token de sessão (`hashSessionToken.ts`, ADR-030): `SHA-256` simples,
 * nunca `Argon2id`.
 *
 * O código tem 256 bits de entropia criptográfica (`crypto.randomBytes`,
 * nunca escolhido por humano), então força bruta é inviável independente
 * da velocidade do hash; e o lookup precisa ser determinístico para
 * encontrar a linha por igualdade exata — `Argon2id` é, por design, não
 * determinístico e portanto inadequado aqui.
 *
 * Retorna hex de 64 caracteres — compatível com `CHAR(64)` em
 * `sso_authorization_codes.code_hash` (migration 0022).
 */
export function hashAuthorizationCode(rawCode: string): string {
  return createHash("sha256").update(rawCode, "utf8").digest("hex");
}
