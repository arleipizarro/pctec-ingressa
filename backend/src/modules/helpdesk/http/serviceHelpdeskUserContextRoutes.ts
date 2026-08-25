import { Router, type Request, type Response, type NextFunction } from "express";
import type { GetHelpdeskUserContextService } from "../application/GetHelpdeskUserContextService.js";

/**
 * Rota HTTP `GET /api/v1/service/helpdesk/users/:legacyUserId/context`
 * — contrato em `docs/import/CONTRATO-SERVICE-HELPDESK.md`.
 *
 * **Fronteira service-to-service**, protegida por
 * `createRequireServiceCredential(..., HELPDESK_SERVICE_CREDENTIAL_HEADER_NAME)`
 * montado em `createApp.ts` ANTES deste router. Consumidor esperado: o
 * backend do Helpdesk, nunca um browser.
 *
 * **Recebe `users.id` do Helpdesk e resolve a Identity ela mesma.** Não
 * aceita `identityPublicId` do chamador — se aceitasse, um bug (ou uma
 * requisição forjada) no Helpdesk pediria o contexto de qualquer
 * pessoa. Mesma decisão já tomada na rota equivalente do Portal.
 *
 * **Payload mínimo:** `{ "organizations": [{ publicId, type, legalName,
 * tradeName }] }`. Nunca devolve identityPublicId, membershipPublicId,
 * profile, scope, legacyId, e-mail, nome, CPF, credencial, hash ou
 * qualquer id interno.
 *
 * **Lista vazia nunca é 200.** Cliente sem membership recebe 403: lista
 * vazia é ambígua entre "não tem acesso" e "tem acesso a nada", e o
 * consumidor tende a tratar a segunda como benigna.
 *
 * **Status (o contrato inteiro está aqui):**
 * - 401 — credencial ausente/inválida (`requireServiceCredential`)
 * - 404 — não há referência ACTIVE: usuário ainda não gerenciado pelo
 *         Ingressa; o Helpdesk mantém o legado
 * - 403 — gerenciado, porém sem autorização (identidade não ACTIVE,
 *         acesso ausente/revogado, perfil insuficiente, sem membership)
 * - 409 — cadastro ambíguo ou inconsistente
 * - 422 — `legacyUserId` malformado (VO `LegacyId`)
 */
export function createServiceHelpdeskUserContextRoutes(
  getHelpdeskUserContextService: GetHelpdeskUserContextService
): Router {
  const router = Router();

  router.get("/users/:legacyUserId/context", (req: Request, res: Response, next: NextFunction) => {
    const rawLegacyUserId = req.params["legacyUserId"];
    if (rawLegacyUserId === undefined || Array.isArray(rawLegacyUserId)) {
      next(new Error("legacyUserId ausente/inválido — wiring incorreto."));
      return;
    }

    getHelpdeskUserContextService
      .execute(rawLegacyUserId)
      .then((contexto) => {
        if (contexto.organizations.length === 0) {
          // 403, nunca 200 com lista vazia — ver docblock.
          res.status(403).json({
            error: {
              code: "HELPDESK_CONTEXT_EMPTY",
              message: "usuário sem organização autorizada no Ingressa."
            }
          });
          return;
        }

        res.status(200).json({
          organizations: contexto.organizations.map((org) => ({
            publicId: org.publicId,
            type: org.type,
            legalName: org.legalName,
            tradeName: org.tradeName ?? null
          }))
        });
      })
      .catch(next);
  });

  return router;
}
