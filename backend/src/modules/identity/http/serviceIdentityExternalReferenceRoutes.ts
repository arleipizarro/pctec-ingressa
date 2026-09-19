import { Router, type Request, type Response, type NextFunction } from "express";
import type { GetActiveIdentityExternalReferenceByIdentityService } from "../application/GetActiveIdentityExternalReferenceByIdentityService.js";

/**
 * `GET /api/v1/service/identity-external-references/:systemCode/:entityType/identities/:identityPublicId`
 *
 * Fronteira **service-to-service**, nunca browser-facing, protegida por
 * `requireServiceCredential` montado no namespace em `createApp.ts`.
 *
 * **Contrato GENÉRICO, de propósito.** `systemCode` e `entityType` são
 * parâmetros, não segmentos literais como na rota do Portal — e não
 * existe nesta rota, nem no service que ela chama, nenhuma menção ao
 * produto que consome a resposta. O Ingressa é a fonte da identidade e
 * do binding cross-system; conhecer o consumidor pelo nome faria dele
 * parte do contrato, e cada produto novo exigiria uma rota nova.
 *
 * **O que a rota responde:** "qual registro do sistema X, entidade Y,
 * esta Identity representa hoje?". A resposta é o `legacyId` daquele
 * sistema — o identificador que só faz sentido lá, e que só o sistema de
 * origem sabe interpretar.
 *
 * **Payload deliberadamente mínimo**: `identityPublicId`, `systemCode`,
 * `entityType` e `legacyId`. Nunca `matchMethod` (como o vínculo foi
 * confirmado é assunto interno do Ingressa), nunca `status` (o contrato
 * já é "a referência ACTIVE"; devolvê-lo sugeriria que pode vir outra
 * coisa), nunca o `publicId` da própria referência, nunca e-mail, nome
 * ou CPF.
 *
 * **Respostas:**
 * - `200` — existe exatamente uma referência ACTIVE;
 * - `404` `IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND` — a Identity não está
 *   vinculada a esse sistema/entidade (ou a referência que existia foi
 *   superada e não houve substituição);
 * - `409` `IDENTITY_EXTERNAL_REFERENCE_AMBIGUOUS` — mais de uma ACTIVE,
 *   estado que a migration 0024 impede de existir; recusa, nunca escolha;
 * - `422` — `identityPublicId`, `systemCode` ou `entityType` inválidos
 *   (recusados pelos Value Objects dentro do service, nunca por
 *   validação duplicada aqui);
 * - `401` — sem a credencial de serviço válida (middleware do namespace).
 *
 * **Identity inexistente responde 404, igual a Identity sem vínculo** —
 * e isso é deliberado: distinguir "essa Identity não existe" de "existe
 * mas não tem vínculo" entregaria, a quem tivesse a credencial, um
 * oráculo de existência de identidades. O consumidor legítimo não
 * precisa da distinção: em ambos os casos não há binding para usar.
 */
export function createServiceIdentityExternalReferenceRoutes(
  getActiveIdentityExternalReferenceByIdentityService: GetActiveIdentityExternalReferenceByIdentityService
): Router {
  const router = Router();

  router.get(
    "/:systemCode/:entityType/identities/:identityPublicId",
    (req: Request, res: Response, next: NextFunction) => {
      const systemCode = req.params["systemCode"];
      const entityType = req.params["entityType"];
      const identityPublicId = req.params["identityPublicId"];
      // Defesa em profundidade — o Express só chega aqui com os três
      // segmentos casados; nunca deveriam ser undefined nem array.
      if (
        typeof systemCode !== "string" ||
        typeof entityType !== "string" ||
        typeof identityPublicId !== "string"
      ) {
        next(new Error("parâmetros de rota ausentes/inválidos — wiring incorreto."));
        return;
      }

      getActiveIdentityExternalReferenceByIdentityService
        .execute(identityPublicId, systemCode, entityType)
        .then((reference) => {
          res.status(200).json({
            identityPublicId: reference.getIdentityPublicId(),
            systemCode: reference.getSystemCode().toString(),
            entityType: reference.getEntityType().toString(),
            legacyId: reference.getLegacyId().toNumber()
          });
        })
        .catch(next);
    }
  );

  return router;
}
