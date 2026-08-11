import { Router, type Response, type NextFunction } from "express";
import type { RequestWithAuthorization } from "../../authorization/http/requireApplicationAccess.js";
import { AuthenticationContextMissingError } from "../../authorization/http/requireApplicationAccess.js";
import type { GetPortalContextService } from "../application/GetPortalContextService.js";

/**
 * Rota HTTP `GET /api/v1/portal/context` — G3 (v0.6.x).
 *
 * Protegida por `requireAuthenticatedSession` → `requireApplicationAccess`
 * (nessa ordem, montados em `createApp.ts`, applicationCode=PCTEC_PORTAL,
 * profile=USER — ver ADR-032) — quando este handler executa, `req.auth`
 * E `req.authorization` já estão garantidamente preenchidos.
 *
 * **Payload mínimo deliberado** (task G3, seção 12): identidade +
 * Organizations (publicId/type/legalName/tradeName) — nunca
 * `legacyId`/`internalId`/`documentNumber`/CNPJ/Credential/Session
 * token/`ApplicationAccess` cru.
 */
export function createPortalContextRoutes(getPortalContextService: GetPortalContextService): Router {
  const router = Router();

  router.get("/context", (req: RequestWithAuthorization, res: Response, next: NextFunction) => {
    if (req.auth === undefined) {
      next(new AuthenticationContextMissingError());
      return;
    }

    getPortalContextService
      .execute(req.auth.identityPublicId)
      .then((context) => {
        res.status(200).json({
          identity: { publicId: context.identityPublicId },
          organizations: context.organizations.map((organization) => ({
            publicId: organization.publicId,
            type: organization.type,
            legalName: organization.legalName,
            tradeName: organization.tradeName ?? null
          }))
        });
      })
      .catch(next);
  });

  return router;
}
