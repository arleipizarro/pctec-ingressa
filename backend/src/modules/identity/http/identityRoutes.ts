import { Router, type NextFunction, type Response } from "express";
import type { GetIdentityByPublicIdService } from "../application/GetIdentityByPublicIdService.js";
import { toIdentityHttpResponse } from "./IdentityHttpMapper.js";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";

/**
 * Rotas HTTP do módulo `identity` — v0.5.0 Slice 1 (Identity Query API).
 *
 * O controller NÃO contém regra de negócio: só traduz a requisição HTTP
 * em uma chamada ao serviço de aplicação, e o resultado (ou erro) em
 * resposta HTTP. Toda decisão de domínio (validar publicId, decidir
 * "não encontrado") acontece em `GetIdentityByPublicIdService`/
 * `PublicId`/`IdentityRepository` — nunca aqui.
 *
 * Erros são sempre repassados via `next(error)` — o handler de erro
 * centralizado em `createApp.ts` decide o status HTTP
 * (`mapDomainErrorToHttp`), nunca este arquivo.
 *
 * Escopo desta fatia: somente `GET /:publicId` (leitura). Não existe
 * `POST`/`PATCH`/`DELETE` aqui — criação/mutação continuam bloqueadas
 * até decisão específica sobre bootstrap/autenticação (ver README).
 */
export function createIdentityRoutes(getIdentityByPublicId: GetIdentityByPublicIdService): Router {
  const router = Router();

  router.get("/:publicId", (req: RequestWithCorrelationId, res: Response, next: NextFunction) => {
    const rawPublicId = req.params["publicId"];
    const publicId = typeof rawPublicId === "string" ? rawPublicId : "";
    getIdentityByPublicId
      .execute(publicId)
      .then((identity) => {
        res.status(200).json(toIdentityHttpResponse(identity));
      })
      .catch(next);
  });

  return router;
}
