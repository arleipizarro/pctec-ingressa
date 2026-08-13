import { Router, type Request, type Response, type NextFunction } from "express";
import type { GetActiveIdentityExternalReferenceService } from "../../identity/application/GetActiveIdentityExternalReferenceService.js";

/**
 * Rota HTTP `GET /api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId`
 * — P1B.0 Fatia 4 (v0.7.x).
 *
 * **Fronteira service-to-service**, protegida por `requireServiceCredential`
 * (montado em `createApp.ts`, ANTES deste router) — mesma infraestrutura
 * de P1A.1, sem duplicação. Namespace `/api/v1/service/portal/...`,
 * completamente separado de `/api/v1/portal/...` (browser-facing).
 *
 * **Propósito único: resolver `legacyId` → `Identity.publicId`.**
 *
 * O Portal tem `req.user.id` = `portal_acesso.id` (legacyId) e não tem
 * como saber qual `Identity.publicId` do Ingressa corresponde a esse
 * usuário. Esta rota resolve isso server-side — o browser NUNCA fornece
 * `identityPublicId` como autoridade (gap real confirmado: caso
 * arlei.pizarro@pctec.com.br / portal_acesso.id=33 / arlei@pizarros.com.br).
 *
 * **Esta rota NÃO concede acesso comercial.** Ela apenas resolve o
 * mapeamento de identidade. O Portal ainda precisará, numa futura P1B,
 * chamar a rota da seção 11 (`/api/v1/service/portal/identities/...`)
 * para verificar `ApplicationAccess` e `OrganizationAccess`.
 *
 * `systemCode=PCTEC_PORTAL` e `entityType=portal_acesso` são segmentos
 * **literais** da URL — não parâmetros. A URL comunica o contrato:
 * esta rota só serve para o sistema Portal, entidade portal_acesso.
 * Outros sistemas/entidades precisariam de rotas próprias (decisão de
 * não criar um endpoint genérico nesta fatia).
 *
 * **Pipeline**: `requireServiceCredential` (no namespace) →
 * `GetActiveIdentityExternalReferenceService` → 200.
 *
 * **Sem `AuthorizeApplicationAccessService` nem `RequireOrganizationAccessService`**:
 * esses verificam O QUE uma Identity pode fazer — aqui sequer sabemos
 * qual é a Identity; estamos resolvendo exatamente isso. Chamar esses
 * services sem identityPublicId seria impossível.
 *
 * **Payload mínimo**: só `{ "identityPublicId": "<uuid>" }`. Nunca
 * retorna `legacyId`, `matchMethod`, e-mail, nome, CPF, status ou o
 * `publicId` da própria referência — só o `identityPublicId` que o
 * Portal precisava descobrir.
 *
 * **`legacyId` inválido** (ex.: não numérico, zero, negativo): o VO
 * `LegacyId` lança `InvalidLegacyIdError` dentro do service — nunca
 * validação duplicada na rota. O handler de erro central de `createApp`
 * captura e retorna 422 (classificação VALIDATION, sem override
 * específico de código — comportamento correto: legacyId inválido não
 * é "recurso não encontrado", é entrada malformada).
 */
export function createServicePortalIdentityExternalReferenceRoutes(
  getActiveIdentityExternalReferenceService: GetActiveIdentityExternalReferenceService
): Router {
  const router = Router();

  router.get(
    "/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId",
    (req: Request, res: Response, next: NextFunction) => {
      const rawLegacyId = req.params["legacyId"];
      // Defesa em profundidade — Express só invoca este handler quando o
      // parâmetro de rota já casou; nunca deveria ser undefined/array aqui.
      if (rawLegacyId === undefined || Array.isArray(rawLegacyId)) {
        next(new Error("legacyId ausente/inválido — wiring incorreto."));
        return;
      }

      getActiveIdentityExternalReferenceService
        .execute("PCTEC_PORTAL", "portal_acesso", rawLegacyId)
        .then((reference) => {
          res.status(200).json({ identityPublicId: reference.getIdentityPublicId() });
        })
        .catch(next);
    }
  );

  return router;
}
