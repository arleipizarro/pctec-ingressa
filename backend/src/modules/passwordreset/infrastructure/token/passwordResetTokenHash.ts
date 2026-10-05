import { createHash, randomBytes } from "node:crypto";

/** 32 bytes = 256 bits — mesma entropia de sessão, código SSO e convite. */
export const PASSWORD_RESET_TOKEN_BYTE_LENGTH = 32;

export interface PasswordResetTokenGenerator {
  generate(): string;
}

/**
 * `base64url` porque o token viaja no FRAGMENTO do link
 * (`https://…/redefinir-senha#<token>`), que o navegador nunca envia ao
 * servidor — mesmo transporte do convite (ver `invitationToken.ts`).
 */
export class CryptoPasswordResetTokenGenerator implements PasswordResetTokenGenerator {
  public generate(): string {
    return randomBytes(PASSWORD_RESET_TOKEN_BYTE_LENGTH).toString("base64url");
  }
}

/**
 * SHA-256 hex. Com 256 bits de entropia o token não precisa de KDF de
 * custo alto, e o lookup precisa ser determinístico. Só o hash é
 * persistido.
 */
export function hashPasswordResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
