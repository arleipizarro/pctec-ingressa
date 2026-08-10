import type { NextFunction, Response } from "express";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import type { ValidateSessionService, AuthenticatedPrincipal } from "../application/ValidateSessionService.js";
import { SessionValidationFailedError } from "../domain/errors/SessionValidationErrors.js";
import { extractSessionTokenFromCookieHeader } from "./sessionCookieParser.js";

/**
 * Extensão mínima e local de `Request` — mesmo padrão de
 * `RequestWithCorrelationId` (`correlationId.ts`): evita `declare
 * global` (que afetaria toda a aplicação Express de uma vez, incluindo
 * módulos futuros sem relação com autenticação).
 *
 * `auth` só existe DEPOIS que `requireAuthenticatedSession` roda com
 * sucesso — rotas que não usam esse middleware nunca têm `req.auth`
 * definido (por isso opcional, `?`).
 */
export interface RequestWithAuth extends RequestWithCorrelationId {
  auth?: AuthenticatedPrincipal;
}

/**
 * Middleware HTTP reutilizável — v0.6.x, Fase E. Lê o cookie de sessão,
 * chama `ValidateSessionService`, anexa `AuthenticatedPrincipal` a
 * `req.auth`.
 *
 * **Nunca resolve autorização** — só prova "quem é você" (autenticação).
 * `ApplicationAccess`/`ADMIN`/roles/permissions ficam para uma camada
 * futura e separada (`requireAdmin` ou equivalente, fora de escopo
 * desta fatia — task, seção 13/26).
 *
 * Falha sempre repassada via `next(error)` — o handler de erro
 * centralizado em `createApp.ts` decide o status HTTP
 * (`mapDomainErrorToHttp`), nunca este middleware.
 */
export function createRequireAuthenticatedSession(validateSessionService: ValidateSessionService) {
  return function requireAuthenticatedSession(req: RequestWithAuth, res: Response, next: NextFunction): void {
    const rawToken = extractSessionTokenFromCookieHeader(req.header("cookie"));

    if (rawToken === undefined) {
      next(new SessionValidationFailedError("COOKIE_ABSENT"));
      return;
    }

    validateSessionService
      .execute({ rawSessionToken: rawToken })
      .then((principal) => {
        req.auth = principal;
        next();
      })
      .catch(next);
  };
}
