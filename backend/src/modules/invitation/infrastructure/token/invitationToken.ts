import { createHash, randomBytes } from "node:crypto";

/** 32 bytes = 256 bits — mesma entropia de token de sessão e código SSO. */
export const INVITATION_TOKEN_BYTE_LENGTH = 32;

export interface InvitationTokenGenerator {
  generate(): string;
}

/**
 * `base64url` porque o token viaja no FRAGMENTO da URL do convite
 * (`https://…/convite#<token>`), e o fragmento nunca é enviado ao
 * servidor: não aparece em access log de Nginx, nem em `Referer`, nem em
 * histórico de proxy. Um token em query string apareceria nos três.
 */
export class CryptoInvitationTokenGenerator implements InvitationTokenGenerator {
  public generate(): string {
    return randomBytes(INVITATION_TOKEN_BYTE_LENGTH).toString("base64url");
  }
}

/**
 * SHA-256 hex — mesmo raciocínio de `hashSessionToken`: o token tem 256
 * bits de entropia, então não precisa de KDF de custo alto; e o lookup
 * precisa ser determinístico. Somente o hash é persistido.
 */
export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}
