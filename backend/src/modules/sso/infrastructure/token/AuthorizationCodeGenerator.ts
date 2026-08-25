import { randomBytes } from "node:crypto";

/**
 * 32 bytes = 256 bits — mesma entropia do token de sessão
 * (`SESSION_TOKEN_BYTE_LENGTH`, ADR-030). Um código de autorização vive
 * no máximo 60 segundos, mas curto no tempo nunca é substituto de
 * imprevisível: adivinhar um código dentro da janela precisa continuar
 * fora de alcance.
 */
export const AUTHORIZATION_CODE_BYTE_LENGTH = 32;

/**
 * Contrato injetável — mesmo princípio de `SessionTokenGenerator`:
 * permite teste determinístico da emissão sem depender de aleatoriedade
 * real.
 */
export interface AuthorizationCodeGenerator {
  generate(): string;
}

/**
 * `base64url` pelo mesmo motivo de `CryptoSessionTokenGenerator`: seguro
 * em URL sem escaping adicional — e o código, ao contrário do token de
 * sessão, trafega mesmo em uma query string de redirect.
 */
export class CryptoAuthorizationCodeGenerator implements AuthorizationCodeGenerator {
  public generate(): string {
    return randomBytes(AUTHORIZATION_CODE_BYTE_LENGTH).toString("base64url");
  }
}
