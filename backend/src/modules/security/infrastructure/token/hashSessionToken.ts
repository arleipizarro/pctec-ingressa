import { createHash } from "node:crypto";

/**
 * Hash do token de sessão — v0.6.0, ADR-030.
 *
 * `SHA-256` simples, não `Argon2id`. Justificativa (ADR-030, "O que é
 * persistido"): o token de sessão já tem 256 bits de entropia
 * criptográfica (gerado por `crypto.randomBytes`, nunca escolhido por um
 * humano) — não é um segredo de baixa entropia como uma senha, que
 * precisa de um algoritmo de custo alto (`Argon2id`) especificamente
 * para compensar a entropia baixa de senhas escolhidas por pessoas. Um
 * hash rápido e determinístico como `SHA-256` é adequado aqui: o espaço
 * de busca de 256 bits torna força bruta inviável independente da
 * velocidade do hash.
 *
 * Determinístico (mesma entrada sempre produz a mesma saída) —
 * necessário para o lookup de sessão por `token_hash` funcionar (ao
 * contrário de `Argon2id`, que é não-determinístico por design, com
 * salt aleatório a cada chamada — adequado para senha, inadequado para
 * um valor que precisa ser buscável por igualdade exata no banco).
 *
 * Retorna hex de 64 caracteres — compatível com `CHAR(64)` em
 * `sessions.token_hash` (migration 0009).
 */
export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
