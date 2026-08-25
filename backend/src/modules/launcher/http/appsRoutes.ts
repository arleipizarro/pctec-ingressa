import { Router, type NextFunction, type Response } from "express";
import type { RequestWithAuth } from "../../security/http/requireAuthenticatedSession.js";
import type { GetMyApplicationsService } from "../application/GetMyApplicationsService.js";

/**
 * `GET /api/v1/apps` — painel "Meus aplicativos".
 *
 * Protegida por `requireAuthenticatedSession` e SÓ por ele: este é o
 * painel de QUALQUER pessoa autenticada, não uma rota administrativa.
 * Montá-la atrás de `requireApplicationAccess(PCTEC_INGRESSA, ADMIN)`
 * — como `/api/v1/admin/*` — deixaria justamente o usuário federado do
 * Helpdesk, que é quem mais precisa do launcher, sem nenhuma tela ao
 * entrar.
 *
 * A autorização que importa aqui é a de CONTEÚDO, e ela está no
 * service: cada card corresponde a um `ApplicationAccess` GRANTED real.
 */
export function createAppsRoutes(getMyApplicationsService: GetMyApplicationsService): Router {
  const router = Router();

  router.get("/", (req: RequestWithAuth, res: Response, next: NextFunction) => {
    const principal = req.auth;
    if (principal === undefined) {
      res.status(401).json({
        error: {
          code: "SESSION_INVALID",
          message: "Sessão inválida ou expirada.",
          correlation_id: req.correlationId ?? null,
          details: []
        }
      });
      return;
    }

    getMyApplicationsService
      .execute(principal.identityPublicId)
      .then((resultado) => {
        res.status(200).json(resultado);
      })
      .catch(next);
  });

  return router;
}
