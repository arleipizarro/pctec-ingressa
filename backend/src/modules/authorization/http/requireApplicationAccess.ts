import type { NextFunction, Response } from "express";
import type { RequestWithAuth } from "../../security/http/requireAuthenticatedSession.js";
import type {
  AuthorizeApplicationAccessService,
  AuthorizedApplicationAccess
} from "../application/AuthorizeApplicationAccessService.js";
import { DomainError } from "../../../shared/errors/DomainError.js";

/**
 * Extensão mínima e local de `Request` — mesmo padrão de
 * `RequestWithAuth`/`RequestWithCorrelationId`: evita `declare global`.
 *
 * `authorization` só existe DEPOIS que `requireApplicationAccess` roda
 * com sucesso. Nunca duplica `identityPublicId`/`sessionPublicId` (já
 * disponíveis em `req.auth`) — só o que é específico da decisão de
 * autorização.
 */
export interface RequestWithAuthorization extends RequestWithAuth {
  authorization?: AuthorizedApplicationAccess;
}

export interface RequireApplicationAccessOptions {
  readonly applicationCode: string;
  readonly profile: string;
}

/**
 * Erro de wiring — v0.6.x, Fase F (task, seção 11: "Se req.auth estiver
 * ausente: isso indica wiring incorreto... falha controlada, não 500
 * bruto"). Nunca deveria acontecer em produção (a ordem correta de
 * montagem sempre coloca `requireAuthenticatedSession` antes deste
 * middleware) — mas se acontecer (erro de programação, rota montada
 * fora de ordem), falha de forma sanitizada em vez de deixar um erro
 * não tratado (`req.auth.identityPublicId` de `undefined`) virar 500
 * genérico do handler central.
 */
export class AuthenticationContextMissingError extends DomainError {
  public readonly code = "AUTHENTICATION_CONTEXT_MISSING";
  public readonly classification = "AUTHENTICATION" as const;

  constructor() {
    super("Contexto de autenticação ausente — requireAuthenticatedSession deve rodar antes deste middleware.");
  }
}

/**
 * Middleware HTTP reutilizável — v0.6.x, Fase F. Exige `req.auth` já
 * presente (produzido por `requireAuthenticatedSession`, montado ANTES
 * deste na cadeia de rota), chama `AuthorizeApplicationAccessService`,
 * anexa `req.authorization` mínimo.
 *
 * **Nunca valida cookie, nunca valida Session, nunca autentica** — esse
 * trabalho já foi feito por `requireAuthenticatedSession`. Este
 * middleware SÓ decide "esta identidade já autenticada pode acessar
 * esta aplicação?".
 *
 * Falha sempre repassada via `next(error)` — o handler de erro
 * centralizado em `createApp.ts` decide o status HTTP
 * (`mapDomainErrorToHttp`), nunca este middleware.
 */
export function createRequireApplicationAccess(
  authorizeApplicationAccessService: AuthorizeApplicationAccessService,
  options: RequireApplicationAccessOptions
) {
  return function requireApplicationAccess(req: RequestWithAuthorization, res: Response, next: NextFunction): void {
    if (req.auth === undefined) {
      next(new AuthenticationContextMissingError());
      return;
    }

    authorizeApplicationAccessService
      .execute({
        identityPublicId: req.auth.identityPublicId,
        applicationCode: options.applicationCode,
        requiredProfile: options.profile
      })
      .then((authorization) => {
        req.authorization = authorization;
        next();
      })
      .catch(next);
  };
}
