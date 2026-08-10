import { randomBytes } from "node:crypto";

/**
 * Comprimento do token de sessão bruto, em bytes — 32 bytes = 256 bits
 * de entropia criptográfica (ADR-030, "Como o token é gerado?").
 */
export const SESSION_TOKEN_BYTE_LENGTH = 32;

/**
 * Contrato de geração do token bruto de sessão — injetável, mesmo
 * princípio de `PasswordHasher` (permite testes determinísticos de
 * `CreateSessionService` sem depender de aleatoriedade real).
 */
export interface SessionTokenGenerator {
  generate(): string;
}

/**
 * Implementação real — `crypto.randomBytes(32)`, codificado em
 * `base64url` (ADR-030: "representação — decidir e centralizar").
 *
 * `base64url` escolhido em vez de `hex`: mais compacto (43 caracteres
 * vs. 64 para os mesmos 256 bits), seguro para uso direto em cookie e em
 * URL sem escaping adicional (alfabeto `base64url` não usa `+`, `/` nem
 * `=` de padding — `Buffer.toString("base64url")` do Node já produz essa
 * variante sem padding).
 */
export class CryptoSessionTokenGenerator implements SessionTokenGenerator {
  public generate(): string {
    return randomBytes(SESSION_TOKEN_BYTE_LENGTH).toString("base64url");
  }
}
