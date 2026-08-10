import { Router, type NextFunction, type Response } from "express";
import type { LoginService } from "../application/LoginService.js";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import { SESSION_COOKIE_NAME, buildSessionCookieOptions, type SessionCookieConfig } from "./sessionCookie.js";

/**
 * Rotas HTTP do módulo `security` — v0.6.0, Fase D (ADR-030).
 *
 * O controller NÃO contém regra de negócio: só traduz a requisição HTTP
 * em uma chamada a `LoginService`, e o resultado (ou erro) em resposta
 * HTTP — mesmo princípio já praticado em `identityRoutes.ts`.
 *
 * Erros são sempre repassados via `next(error)` — o handler de erro
 * centralizado em `createApp.ts` decide o status HTTP
 * (`mapDomainErrorToHttp`), nunca este arquivo. `AuthenticationFailedError`
 * já carrega `classification = "AUTHENTICATION"` → 401 automaticamente.
 *
 * Escopo desta fatia: somente `POST /` (login). Não existe
 * `DELETE /current` (logout) nem qualquer rota de validação de sessão
 * ainda — fora de escopo desta entrega (ADR-030, "O que fica para
 * implementação futura").
 */
export function createSessionRoutes(loginService: LoginService, cookieConfig: SessionCookieConfig): Router {
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

  return router;
}
