import { Router, type NextFunction, type Response } from "express";
import type { LoginService } from "../application/LoginService.js";
import type { LogoutService } from "../application/LogoutService.js";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  buildClearSessionCookieOptions,
  type SessionCookieConfig
} from "./sessionCookie.js";
import { extractSessionTokenFromCookieHeader } from "./sessionCookieParser.js";
import { isCsrfSafeRequest } from "./csrfGuard.js";
import { SessionValidationFailedError } from "../domain/errors/SessionValidationErrors.js";

/**
 * Rotas HTTP do módulo `security` — v0.6.0/v0.6.x (ADR-030, Fases D/E).
 *
 * O controller NÃO contém regra de negócio: só traduz a requisição HTTP
 * em uma chamada a `LoginService`/`LogoutService`, e o resultado (ou
 * erro) em resposta HTTP — mesmo princípio já praticado em
 * `identityRoutes.ts`.
 *
 * Erros são sempre repassados via `next(error)` — o handler de erro
 * centralizado em `createApp.ts` decide o status HTTP
 * (`mapDomainErrorToHttp`), nunca este arquivo. `AuthenticationFailedError`/
 * `SessionValidationFailedError` já carregam `classification =
 * "AUTHENTICATION"` → 401 automaticamente.
 *
 * `POST /` (login, Fase D) + `DELETE /current` (logout, Fase E,
 * implementado nesta fatia — task, seção 21, preferência SIM).
 */
export function createSessionRoutes(
  loginService: LoginService,
  logoutService: LogoutService,
  cookieConfig: SessionCookieConfig,
  allowedOrigins: readonly string[]
): Router {
  const router = Router();

  router.post("/", (req: RequestWithCorrelationId, res: Response, next: NextFunction) => {
    // Corpo não-string (ausente, número, objeto, etc.) é normalizado
    // para string vazia — nunca um caminho de validação DISTINTO de
    // "e-mail/senha incorretos". Isso evita introduzir uma segunda
    // classe de erro (ex.: 422 "corpo malformado") com HTTP/timing
    // observavelmente diferente de AUTHENTICATION_FAILED (401) para uma
    // requisição de login — mesmo princípio de uniformidade de resposta
    // já aplicado ao restante do fluxo (ADR-030, "Proteção contra
    // enumeração"). Uma string vazia simplesmente não corresponde a
    // nenhuma Identity/senha real, resultando no mesmo
    // AuthenticationFailedError genérico.
    const body = req.body as Record<string, unknown> | undefined;
    const email = typeof body?.["email"] === "string" ? (body["email"] as string) : "";
    const password = typeof body?.["password"] === "string" ? (body["password"] as string) : "";

    loginService
      .execute({ email, password, correlationId: req.correlationId })
      .then((result) => {
        res.cookie(SESSION_COOKIE_NAME, result.rawToken, buildSessionCookieOptions(result.expiresAt, cookieConfig));
        // Location — decisão fechada (revisão crítica, item 14): enviado
        // já nesta fatia, apontando para o recurso Session criado
        // (`/api/v1/sessions/{publicId}`), mesmo que o `GET` individual
        // correspondente ainda não exista. `Location` em uma resposta
        // `201 Created` é uma declaração sobre a identidade canônica do
        // recurso recém-criado — semanticamente válida independente de
        // o endpoint de leitura já estar implementado (ADR-030, "POST
        // /api/v1/sessions — 201, decisão fechada"). Evita a divergência
        // entre documentação e implementação: a ADR já previa isso,
        // agora o código cumpre.
        res.location(`/api/v1/sessions/${result.sessionPublicId}`);
        // 201 Created — POST /api/v1/sessions cria um recurso Session
        // com identidade própria e efeito colateral persistente
        // (ADR-030, "POST /api/v1/sessions — 201, decisão fechada").
        // rawToken NUNCA aparece no corpo — só no cookie. ADMIN/
        // applicationAccesses/roles/permissions também nunca aparecem
        // (ADR-030, questão 8).
        res.status(201).json({
          session: { publicId: result.sessionPublicId, expiresAt: result.expiresAt.toISOString() },
          identity: { publicId: result.identityPublicId }
        });
      })
      .catch(next);
  });

  // DELETE /api/v1/sessions/current — logout (v0.6.x, Fase E).
  //
  // Primeira rota MUTÁVEL autenticada por cookie desta base — o helper
  // CSRF (`csrfGuard.ts`, preparado desde a Fase D mas nunca antes
  // aplicado) entra em uso aqui, conforme ADR-030 previu: "a validação
  // de Origin se aplica a partir do DELETE /sessions/current/logout".
  router.delete("/current", (req: RequestWithCorrelationId, res: Response, next: NextFunction) => {
    // CSRF ANTES de qualquer outra coisa — nunca processa a revogação
    // se a origem não é confiável, mesmo que o cookie seja válido.
    const csrfSafe = isCsrfSafeRequest({
      origin: req.header("origin"),
      referer: req.header("referer"),
      allowedOrigins
    });
    if (!csrfSafe) {
      // 403 — CSRF é uma falha de AUTORIZAÇÃO da origem da requisição,
      // nunca de autenticação da sessão em si (a sessão pode ser
      // perfeitamente válida; a requisição é que não é confiável).
      res.status(403).json({
        error: {
          code: "CSRF_ORIGIN_REJECTED",
          message: "Origem da requisição não é confiável.",
          correlation_id: req.correlationId ?? null,
          details: []
        }
      });
      return;
    }

    const rawToken = extractSessionTokenFromCookieHeader(req.header("cookie"));
    if (rawToken === undefined) {
      next(new SessionValidationFailedError("COOKIE_ABSENT"));
      return;
    }

    logoutService
      .execute({ rawSessionToken: rawToken, correlationId: req.correlationId })
      .then(() => {
        // Limpa o cookie com EXATAMENTE os mesmos atributos usados ao
        // criá-lo (task, seção 23) — nunca basta revogar no banco sem
        // limpar o navegador, nem limpar o navegador sem revogar no
        // banco. Ambos acontecem aqui: o banco já foi revogado dentro
        // de logoutService.execute() (transação já committada nesta
        // altura); a limpeza do cookie acontece agora, na resposta.
        res.clearCookie(SESSION_COOKIE_NAME, buildClearSessionCookieOptions(cookieConfig));
        res.status(204).end();
      })
      .catch(next);
  });

  return router;
}
