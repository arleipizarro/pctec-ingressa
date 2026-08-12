import { Router, type Response, type NextFunction } from "express";
import type { RequestWithAuthorization } from "../../authorization/http/requireApplicationAccess.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../organization/application/GetActiveOrganizationExternalReferenceService.js";

/**
 * Rota HTTP `GET /api/v1/portal/organizations/:organizationPublicId/external-references/PCTEC_PORTAL`
 * — P1 Portal (v0.7.x).
 *
 * **Primeira rota real a montar `requireOrganizationAccess`** desde que
 * o middleware foi implementado em G3 (preparado, nunca usado em rota
 * real até esta entrega). Pipeline completo, montado em `createApp.ts`:
 *
 * ```
 * requireAuthenticatedSession
 *   → requireApplicationAccess(PCTEC_PORTAL, USER)
 *   → requireOrganizationAccess
 *   → este handler
 * ```
 *
 * `systemCode=PCTEC_PORTAL` é um segmento LITERAL da rota (não um
 * parâmetro) — o próprio roteamento do Express só entrega ao handler
 * requisições cujo path bate exatamente com esse literal; qualquer
 * outro valor nesse segmento nunca alcança este arquivo (vira 404 de
 * rota não encontrada, antes mesmo de tentar autenticar). `entityType`
 * é fixado internamente como `"clientes"` — nunca `"clientes_grupo"`,
 * nunca aceito como parâmetro de rota (decisão do piloto AFIP: grupo
 * legado nunca produz contexto comercial).
 *
 * **Payload mínimo deliberado**: `organization.publicId` +
 * `externalReference.{systemCode,entityType,legacyId}` — nunca
 * `internalId`/`documentNumber`/`Membership`/`Credential`/Session
 * token/dado de auditoria/referências de outros sistemas.
 */
export function createOrganizationExternalReferenceRoutes(
  requireOrganizationAccess: (req: RequestWithAuthorization, res: Response, next: NextFunction) => void,
  getActiveOrganizationExternalReferenceService: GetActiveOrganizationExternalReferenceService
): Router {
  const router = Router();

  router.get(
    "/organizations/:organizationPublicId/external-references/PCTEC_PORTAL",
    requireOrganizationAccess,
    (req: RequestWithAuthorization, res: Response, next: NextFunction) => {
      const rawOrganizationPublicId = req.params["organizationPublicId"];
      // Defesa em profundidade — requireOrganizationAccess já garante
      // que este parâmetro existe (senão já teria falhado antes com
      // OrganizationAccessRouteParamMissingError); nunca deveria ser
      // undefined/array aqui, mas o handler nunca assume isso
      // silenciosamente.
      if (rawOrganizationPublicId === undefined || Array.isArray(rawOrganizationPublicId)) {
        next(new Error("organizationPublicId ausente/inválido após requireOrganizationAccess — wiring incorreto."));
        return;
      }
      const organizationPublicId: string = rawOrganizationPublicId;

      getActiveOrganizationExternalReferenceService
        .execute(organizationPublicId, "PCTEC_PORTAL", "clientes")
        .then((reference) => {
          res.status(200).json({
            organization: { publicId: reference.getOrganizationPublicId() },
            externalReference: {
              systemCode: reference.getSystemCode().toString(),
              entityType: reference.getEntityType().toString(),
              legacyId: reference.getLegacyId().toNumber()
            }
          });
        })
        .catch(next);
    }
  );

  return router;
}
