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

/**
 * Constrói as opções de `res.clearCookie(...)` para o logout — v0.6.x,
 * Fase E (task, seção 23: "Logout deve limpar exatamente o mesmo
 * cookie: mesmo name/Path/Secure/SameSite"). Deliberadamente as MESMAS
 * opções estruturais de `buildSessionCookieOptions` (exceto `expires`,
 * que o Express já gerencia internamente em `clearCookie` — passar um
 * valor aqui seria redundante). Um cookie definido com um `Path`/
 * `Secure`/`SameSite` e "limpo" com atributos diferentes NÃO é removido
 * pelo navegador (a correspondência de atributos é exigida pela própria
 * spec de cookies) — por isso este helper existe, para nunca divergir
 * acidentalmente dos atributos usados ao criar o cookie.
 */
export function buildClearSessionCookieOptions(config: SessionCookieConfig): {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly path: "/";
} {
  return {
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/"
  };
}
