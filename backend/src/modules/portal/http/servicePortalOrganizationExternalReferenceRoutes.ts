import { Router, type Request, type Response, type NextFunction } from "express";
import type { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../application/RequireOrganizationAccessService.js";
import type { GetActiveOrganizationExternalReferenceService } from "../../organization/application/GetActiveOrganizationExternalReferenceService.js";
import { PCTEC_PORTAL_APPLICATION_CODE } from "../../application/domain/value-objects/ApplicationCodes.js";

/**
 * Rota HTTP `GET /api/v1/service/portal/identities/:identityPublicId/organizations/:organizationPublicId/external-references/PCTEC_PORTAL`
 * — P1A.1 (v0.7.x).
 *
 * **Fronteira service-to-service, protegida por `requireServiceCredential`
 * (montado em `createApp.ts`, ANTES deste router) — nunca por sessão de
 * usuário.** Namespace `/api/v1/service/portal/...`, deliberadamente
 * separado de `/api/v1/portal/...` (browser-facing) — nunca compartilha
 * pipeline, nunca é alcançável por um browser real.
 *
 * **`identityPublicId` só é uma entrada confiável AQUI porque a chamada
 * inteira já é service-to-service, autenticada pela credencial de
 * serviço** — o Ingressa NUNCA recomputa "quem é você" a partir desse
 * parâmetro (isso seria confiar cegamente no chamador); ele recomputa
 * "o que essa Identity pode fazer" a partir dele, com os MESMOS
 * services já usados na rota browser-facing:
 * `AuthorizeApplicationAccessService` (a Identity tem
 * `ApplicationAccess(PCTEC_PORTAL, USER)`?) e
 * `RequireOrganizationAccessService` (a Organization pertence ao
 * `PortalContext` real dessa Identity?). **Nenhum dos dois é alterado
 * por esta rota** — reaproveitados exatamente como já existiam.
 *
 * Esta rota **nunca** deve ser chamada com um `identityPublicId`
 * originado do browser sem prova — essa é uma responsabilidade do
 * chamador (o backend do Portal, não implementado nesta entrega), não
 * algo que o Ingressa possa impor de dentro desta rota.
 *
 * **Payload mínimo, ainda mais restrito que a rota browser-facing**:
 * só `{ "legacyId": <número> }` — nunca `identityPublicId`,
 * `organizationPublicId`, `Membership`, CNPJ ou qualquer detalhe da
 * referência além do `legacyId` em si.
 */
export function createServicePortalOrganizationExternalReferenceRoutes(
  authorizeApplicationAccessService: AuthorizeApplicationAccessService,
  requireOrganizationAccessService: RequireOrganizationAccessService,
  getActiveOrganizationExternalReferenceService: GetActiveOrganizationExternalReferenceService
): Router {
  const router = Router();

  router.get(
    "/identities/:identityPublicId/organizations/:organizationPublicId/external-references/PCTEC_PORTAL",
    (req: Request, res: Response, next: NextFunction) => {
      const rawIdentityPublicId = req.params["identityPublicId"];
      const rawOrganizationPublicId = req.params["organizationPublicId"];
      // Defesa em profundidade — Express só invoca este handler quando
      // ambos os parâmetros da rota já casaram; nunca deveria ser
      // undefined/array aqui, mas o handler nunca assume isso
      // silenciosamente.
      if (
        rawIdentityPublicId === undefined ||
        Array.isArray(rawIdentityPublicId) ||
        rawOrganizationPublicId === undefined ||
        Array.isArray(rawOrganizationPublicId)
      ) {
        next(new Error("identityPublicId/organizationPublicId ausente/inválido — wiring incorreto."));
        return;
      }
      const identityPublicId: string = rawIdentityPublicId;
      const organizationPublicId: string = rawOrganizationPublicId;

      authorizeApplicationAccessService
        .execute({
          identityPublicId,
          applicationCode: PCTEC_PORTAL_APPLICATION_CODE,
          requiredProfile: "USER"
        })
        .then(() => requireOrganizationAccessService.execute(identityPublicId, organizationPublicId))
        .then(() =>
          getActiveOrganizationExternalReferenceService.execute(organizationPublicId, "PCTEC_PORTAL", "clientes")
        )
        .then((reference) => {
          res.status(200).json({ legacyId: reference.getLegacyId().toNumber() });
        })
        .catch(next);
    }
  );

  return router;
}
