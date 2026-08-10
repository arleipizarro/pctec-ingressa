import { Router, type Response } from "express";
import type { RequestWithAuthorization } from "./requireApplicationAccess.js";

/**
 * Rota HTTP `GET /api/v1/admin/whoami` — v0.6.x, Fase F.
 *
 * Primeira rota administrativa de prova: comprova que somente uma
 * Identity autenticada COM `ApplicationAccess` `ADMIN`/`GRANTED` para
 * `PCTEC_INGRESSA` passa. Protegida por `requireAuthenticatedSession` →
 * `requireApplicationAccess` (nessa ordem, montados em `createApp.ts`)
 * — quando este handler executa, `req.auth` E `req.authorization` já
 * estão garantidamente preenchidos.
 *
 * **Payload mínimo deliberado** (task, seção 13): identidade, código da
 * aplicação, perfil — nunca senha/Credential/token/Session token/dados
 * pessoais desnecessários.
 */
export function createAdminWhoamiRoutes(): Router {
  const router = Router();

  router.get("/whoami", (req: RequestWithAuthorization, res: Response) => {
    const authorization = req.authorization;
    if (authorization === undefined) {
      res.status(403).json({
        error: {
          code: "APPLICATION_ACCESS_DENIED",
          message: "Acesso negado a esta aplicação.",
          correlation_id: req.correlationId ?? null,
          details: []
        }
      });
      return;
    }

    res.status(200).json({
      identity: { publicId: authorization.identityPublicId },
      application: { code: authorization.applicationCode },
      access: { profile: authorization.accessProfile }
    });
  });

  return router;
}
