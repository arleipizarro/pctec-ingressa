import { Router, type Request, type Response, type NextFunction } from "express";
import type { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { GetPortalContextService } from "../application/GetPortalContextService.js";

/**
 * Rota HTTP `GET /api/v1/service/portal/identities/:identityPublicId/context`
 * — P1B.1 (v0.7.x).
 *
 * **Fronteira service-to-service**, protegida por `requireServiceCredential`
 * (montado em `createApp.ts`, ANTES deste router) — mesma infraestrutura de
 * P1A.1 e Fatia 4, sem duplicação.
 *
 * **Propósito:** dado um `identityPublicId` já resolvido server-side pelo
 * Portal (via Fatia 4: `portal_acesso.id → Identity.publicId`), retornar
 * as Organizations que essa Identity pode acessar no contexto do Portal.
 *
 * **Pipeline obrigatório (equivalente service-to-service da rota browser-facing
 * `GET /api/v1/portal/context`):**
 *
 * ```
 * requireServiceCredential           (namepspace, não duplicado)
 * → AuthorizeApplicationAccessService({ identityPublicId, PCTEC_PORTAL, USER })
 * → GetPortalContextService(identityPublicId)
 * → resposta sanitizada
 * ```
 *
 * **Por que `AuthorizeApplicationAccessService` é obrigatório aqui:**
 * `IdentityExternalReference` (Fatia 4) prova apenas o VÍNCULO entre
 * `portal_acesso.id` e uma `Identity` — ela NÃO prova que essa Identity
 * ainda tem `ApplicationAccess(PCTEC_PORTAL, USER)`. Esses são eixos
 * independentes (ADR-031 §6). Sem esta verificação, uma Identity com
 * acesso revogado ainda veria o contexto — o que violaria o contrato de
 * revogação.
 *
 * **Reutilização sem alteração:**
 * - `AuthorizeApplicationAccessService` — mesma instância de `createApp.ts`
 * - `GetPortalContextService` — mesma instância de `createApp.ts`; já
 *   implementa Membership + `ORGANIZATION_AND_DESCENDANTS` + deduplicação.
 *   O Portal NÃO reimplementa nenhuma dessas regras.
 *
 * **Payload mínimo (por decisão formal P1B.1):**
 * Retorna apenas `{ "organizations": [...] }` com exatamente 4 campos por
 * organização: `publicId`, `type`, `legalName`, `tradeName`.
 * Nunca retorna: `identityPublicId`, `membershipPublicId`, `profile`,
 * `scope`, `cliente_id`, `legacyId`, ids internos, service credential.
 *
 * **Erros:**
 * - `requireServiceCredential` falha → 401 `SERVICE_CREDENTIAL_INVALID`
 * - `AuthorizeApplicationAccessService` lança → 403 `APPLICATION_ACCESS_DENIED`
 * - Demais erros → mapeamento padrão de domínio (`mapDomainErrorToHttp`)
 */
export function createServicePortalIdentityContextRoutes(
  authorizeApplicationAccessService: AuthorizeApplicationAccessService,
  getPortalContextService: GetPortalContextService
): Router {
  const router = Router();

  router.get(
    "/identities/:identityPublicId/context",
    (req: Request, res: Response, next: NextFunction) => {
      const rawIdentityPublicId = req.params["identityPublicId"];
      if (rawIdentityPublicId === undefined || Array.isArray(rawIdentityPublicId)) {
        next(new Error("identityPublicId ausente/inválido — wiring incorreto."));
        return;
      }

      // 1. Verificar que a Identity ainda tem ApplicationAccess(PCTEC_PORTAL, USER).
      //    Lança ApplicationAccessDeniedError (403) se não tiver.
      authorizeApplicationAccessService
        .execute({
          identityPublicId: rawIdentityPublicId,
          applicationCode: "PCTEC_PORTAL",
          requiredProfile: "USER"
        })
        // 2. Calcular PortalContext: Membership → Organizations (inclui expansão
        //    ORGANIZATION_AND_DESCENDANTS e deduplicação). Lógica NUNCA duplicada
        //    aqui — integralmente delegada a GetPortalContextService.
        .then(() => getPortalContextService.execute(rawIdentityPublicId))
        .then((context) => {
          res.status(200).json({
            organizations: context.organizations.map((org) => ({
              publicId: org.publicId,
              type: org.type,
              legalName: org.legalName,
              tradeName: org.tradeName ?? null
            }))
          });
        })
        .catch(next);
    }
  );

  return router;
}
