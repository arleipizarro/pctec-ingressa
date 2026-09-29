import { Router, type Request, type Response, type NextFunction } from "express";
import type { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { ApplicationRoleService } from "../../applicationrole/application/ApplicationRoleService.js";

/**
 * Rota HTTP `GET /api/v1/service/portal/identities/:identityPublicId/application-roles`.
 *
 * **Fronteira service-to-service**, protegida por `requireServiceCredential`
 * (montado em `createApp.ts`, ANTES deste router) — o mesmo namespace e a
 * mesma credencial das demais rotas do Portal.
 *
 * **Propósito:** entregar ao Portal a camada 2 de ADR-007 (ADR-036) — os
 * perfis que a Identity tem DENTRO do Portal, hoje só
 * `PORTAL_ADMIN_GLOBAL`. O Portal traduz o código em permissão
 * (`portal:clientes:visualizar_todos`) no próprio código; aqui só saem
 * os códigos, nunca a interpretação deles.
 *
 * **A camada 1 continua sendo pré-requisito**, e é conferida AQUI pelo
 * mesmo `AuthorizeApplicationAccessService` das outras rotas do Portal:
 * sem `ApplicationAccess(PCTEC_PORTAL, USER)` GRANTED a resposta é 403
 * `APPLICATION_ACCESS_DENIED`, e nunca uma lista de perfis. Perfil sem
 * acesso seria autorização guardada como se levasse a algum lugar.
 *
 * O Portal consulta esta rota a CADA requisição que usa a visão global —
 * revogar o perfil aqui vale na requisição seguinte, sem esperar sessão
 * expirar.
 *
 * **Payload mínimo:** `{ "roles": ["PORTAL_ADMIN_GLOBAL"] }`. Nada de
 * quem concedeu, quando, ids internos ou dado pessoal.
 */
export function createServicePortalApplicationRolesRoutes(
  authorizeApplicationAccessService: AuthorizeApplicationAccessService,
  applicationRoleService: ApplicationRoleService
): Router {
  const router = Router();

  router.get(
    "/identities/:identityPublicId/application-roles",
    (req: Request, res: Response, next: NextFunction) => {
      const identityPublicId = req.params["identityPublicId"];
      if (identityPublicId === undefined || Array.isArray(identityPublicId)) {
        next(new Error("identityPublicId ausente/inválido — wiring incorreto."));
        return;
      }

      authorizeApplicationAccessService
        .execute({ identityPublicId, applicationCode: "PCTEC_PORTAL", requiredProfile: "USER" })
        .then(() => applicationRoleService.perfisConcedidos(identityPublicId, "PCTEC_PORTAL"))
        .then((roles) => {
          res.status(200).json({ roles: [...roles] });
        })
        .catch(next);
    }
  );

  return router;
}
