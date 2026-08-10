/**
 * Validação mínima de CSRF (Origin com fallback para Referer) — ADR-030,
 * seção "CSRF".
 *
 * **Não aplicado a `POST /api/v1/sessions` (login) nesta entrega** —
 * ADR-030 é explícita: "a validação de `Origin` se aplica a partir do
 * `DELETE /sessions/current`/logout e a qualquer endpoint mutável futuro
 * que exija sessão já estabelecida". CSRF protege uma sessão EXISTENTE
 * sendo abusada por um site malicioso; no momento do login em si, ainda
 * não existe sessão para proteger — o próprio ato de logar exige que a
 * pessoa digite e-mail/senha corretos, o que já é a defesa. Esta função
 * fica preparada para o primeiro endpoint mutável futuro que exigir uma
 * sessão já ativa (ex.: logout).
 *
 * Token CSRF dedicado (`double-submit cookie` ou equivalente):
 * permanece deferido — esta validação de `Origin`/`Referer` é a política
 * mínima desta fase, não a defesa final (ADR-030).
 */
export interface CsrfCheckInput {
  readonly origin: string | undefined;
  readonly referer: string | undefined;
  readonly allowedOrigins: readonly string[];
}

function extractOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/**
 * Retorna `true` se a requisição deve ser ACEITA (origem confiável),
 * `false` se deve ser REJEITADA (403).
 *
 * Regras (ADR-030):
 * 1. `Origin` presente → deve corresponder a uma das `allowedOrigins`.
 * 2. `Origin` ausente, `Referer` presente → mesma checagem, usando a
 *    origem extraída do `Referer`.
 * 3. Nem `Origin` nem `Referer` presentes → rejeitado (nunca assume
 *    "ausência é segura").
 */
export function isCsrfSafeRequest(input: CsrfCheckInput): boolean {
  if (input.origin !== undefined && input.origin.length > 0) {
    return input.allowedOrigins.includes(input.origin);
  }
  if (input.referer !== undefined && input.referer.length > 0) {
    const refererOrigin = extractOrigin(input.referer);
    return refererOrigin !== undefined && input.allowedOrigins.includes(refererOrigin);
  }
  return false;
}
