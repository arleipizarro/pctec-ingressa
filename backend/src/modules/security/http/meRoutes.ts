import { Router, type Response } from "express";
import type { RequestWithAuth } from "./requireAuthenticatedSession.js";

/**
 * Rota HTTP `GET /api/v1/me` — v0.6.x, Fase E.
 *
 * Prova que o cookie criado no login autentica uma requisição
 * posterior — não faz mais nada além disso. Protegida por
 * `requireAuthenticatedSession` (montado em `createApp.ts`, antes desta
 * rota) — quando este handler executa, `req.auth` já está garantidamente
 * preenchido.
 *
 * **Payload mínimo deliberado** (task, seção 12): apenas
 * `identity.publicId`/`session.publicId` — nunca `email`/`fullName`
 * (sem necessidade demonstrada nesta fatia), nunca `ADMIN`/
 * `applicationAccesses`/roles/permissions (autorização é uma camada
 * futura separada — task, seção 13).
 *
 * **Não produz nenhum `Domain Event`** — uma leitura não é uma mudança
 * de estado de negócio.
 */
export function createMeRoutes(): Router {
  const router = Router();

  router.get("/", (req: RequestWithAuth, res: Response) => {
    const principal = req.auth;
    if (principal === undefined) {
      // Defesa em profundidade: nunca deveria acontecer (o middleware
      // requireAuthenticatedSession sempre roda antes desta rota, em
      // createApp.ts), mas nunca confiamos silenciosamente nisso — na
      // hipótese de um erro de montagem de rota, falha de forma segura
      // (401 genérico), nunca um 500/undefined vazando.
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

    res.status(200).json({
      identity: { publicId: principal.identityPublicId },
      session: { publicId: principal.sessionPublicId }
    });
  });

  return router;
}
