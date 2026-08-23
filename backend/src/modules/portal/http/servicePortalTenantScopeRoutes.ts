import { Router, type Request, type Response, type NextFunction } from "express";
import type { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import type { RequireOrganizationAccessService } from "../application/RequireOrganizationAccessService.js";
import type { ResolvePortalTenantScopeService } from "../application/ResolvePortalTenantScopeService.js";
import { PCTEC_PORTAL_APPLICATION_CODE } from "../../application/domain/value-objects/ApplicationCodes.js";

/**
 * Rota HTTP `GET /api/v1/service/portal/identities/:identityPublicId/organizations/:organizationPublicId/tenant-scope`
 * — P1D (v0.7.x).
 *
 * **Fronteira service-to-service, protegida por `requireServiceCredential`**
 * (montado em `createApp.ts`, ANTES deste router) — mesmo namespace
 * `/api/v1/service/portal/...` e mesma credencial de máquina de P1A.1 /
 * P1B.0 Fatia 4 / P1B.1, sem duplicação de middleware. Chamador
 * esperado: o backend do `pctec-portal`, nunca um browser.
 *
 * **Propósito:** dada uma seleção do usuário (uma `COMPANY` OU um
 * `BUSINESS_GROUP`), devolver o conjunto completo de organizações
 * comerciais que aquela seleção representa, cada uma já resolvida para
 * o `clientes.id` do Portal legado. É o que permite o Portal consolidar
 * faturamento/contratos/equipamentos/vencimentos/chamados de um grupo
 * inteiro sem jamais reimplementar hierarquia organizacional.
 *
 * **Generaliza a rota de P1A.1 (seção 11 do contrato), sem substituí-la:**
 * lá, `BUSINESS_GROUP` só poderia responder 404 (um grupo não tem
 * referência `clientes` própria); aqui ele é expandido nas filhas.
 * A rota de P1A.1 continua intacta e independente.
 *
 * **Pipeline obrigatório, sempre nesta ordem:**
 *
 * ```
 * requireServiceCredential                       (namespace, não duplicado)
 * → AuthorizeApplicationAccessService(identityPublicId, PCTEC_PORTAL, USER)
 * → RequireOrganizationAccessService(identityPublicId, organizationPublicId)
 *      ↳ devolve o PortalContext que usou para autorizar
 * → ResolvePortalTenantScopeService(organizationPublicId, <ids autorizados>)
 * ```
 *
 * Os dois primeiros são EXATAMENTE os mesmos services já usados por
 * P1A.1: a credencial de máquina prova "quem está chamando" (o Portal),
 * nunca "em nome de quem" — por isso o Ingressa recomputa
 * `ApplicationAccess` e `OrganizationAccess` a partir do
 * `identityPublicId` recebido.
 *
 * **O `PortalContext` é calculado UMA vez e atravessa o pipeline
 * (correção de revisão, C-1).** `RequireOrganizationAccessService`
 * devolve o contexto que já usou para autorizar, e esta rota o repassa
 * como conjunto de `publicId` autorizados. Isso resolve duas coisas de
 * uma vez: (a) nenhuma segunda passagem pelo `MembershipRepository`;
 * (b) — o ponto que importa — o escopo consolidado é a **interseção**
 * entre as filhas canônicas do grupo e o que a Identity realmente
 * alcança. Autorizar o grupo NÃO autoriza as filhas: um
 * `Membership(BUSINESS_GROUP, ORGANIZATION_ONLY)` põe o grupo no
 * contexto e nenhuma filha, e expandir mesmo assim seria escalada de
 * privilégio.
 *
 * **Payload:** `selection` (o que foi escolhido) + `organizations[]` (o
 * escopo comercial efetivo, com `legacyId`). `legacyId` é o único
 * identificador legado exposto — nunca `internalId`, nunca
 * `membershipPublicId`, nunca CNPJ, nunca `identityPublicId`.
 */
export function createServicePortalTenantScopeRoutes(
  authorizeApplicationAccessService: AuthorizeApplicationAccessService,
  requireOrganizationAccessService: RequireOrganizationAccessService,
  resolvePortalTenantScopeService: ResolvePortalTenantScopeService
): Router {
  const router = Router();

  router.get(
    "/identities/:identityPublicId/organizations/:organizationPublicId/tenant-scope",
    (req: Request, res: Response, next: NextFunction) => {
      const rawIdentityPublicId = req.params["identityPublicId"];
      const rawOrganizationPublicId = req.params["organizationPublicId"];
      // Defesa em profundidade — Express só invoca este handler quando
      // ambos os parâmetros já casaram; nunca deveria ser
      // undefined/array aqui, mas o handler nunca assume isso em
      // silêncio.
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
        // O contexto devolvido é o MESMO que autorizou a requisição —
        // nunca um recalculado depois da decisão.
        .then((portalContext) =>
          resolvePortalTenantScopeService.execute(
            organizationPublicId,
            new Set(portalContext.organizations.map((organization) => organization.publicId))
          )
        )
        .then((scope) => {
          res.status(200).json({
            selection: {
              publicId: scope.selection.publicId,
              type: scope.selection.type,
              legalName: scope.selection.legalName,
              tradeName: scope.selection.tradeName ?? null
            },
            organizations: scope.organizations.map((organization) => ({
              publicId: organization.publicId,
              type: organization.type,
              legalName: organization.legalName,
              tradeName: organization.tradeName ?? null,
              legacyId: organization.legacyId
            }))
          });
        })
        .catch(next);
    }
  );

  return router;
}
