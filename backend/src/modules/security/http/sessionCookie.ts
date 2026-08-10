/**
 * Nome do cookie de sessão — centralizado aqui, nunca uma string mágica
 * espalhada pelo código (ADR-030, "Cookie — parâmetros"; mesmo princípio
 * já aplicado a `LOCAL_PASSWORD`/`ACTIVE` em ADR-029).
 */
export const SESSION_COOKIE_NAME = "ingressa_session";

export interface SessionCookieConfig {
  /**
   * `SESSION_COOKIE_SECURE` (env, ADR-030) — nunca `false` em produção
   * (gate já aplicado em `loadEnv()`, `app/config/env.ts`).
   */
  readonly secure: boolean;
}

/**
 * Constrói as opções de `res.cookie(...)` para o cookie de sessão —
 * conforme ADR-030, "Cookie — parâmetros": `HttpOnly` sempre `true`
 * (nunca configurável — não há cenário legítimo para desabilitar),
 * `SameSite=Lax`, `Path=/`, `Max-Age` derivado de `expiresAt` (nunca um
 * valor fixo independente da expiração real da sessão no servidor).
 */
export function buildSessionCookieOptions(
  expiresAt: Date,
  config: SessionCookieConfig
): {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly expires: Date;
} {
  return {
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt
  };
}
