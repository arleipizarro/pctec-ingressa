import { Router, type NextFunction, type Request, type Response } from "express";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import { consumidorAutenticado } from "../../portal/http/requireServiceCredential.js";
import type { CentralServicosService } from "../application/CentralServicosService.js";
import { AUDIENCE_HELPDESK } from "../domain/DelegationAssertion.js";

function envolver(manipulador: (req: RequestWithCorrelationId, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    manipulador(req as RequestWithCorrelationId, res).catch(next);
  };
}

/**
 * `/api/v1/service/central-servicos/*` — fronteira service-to-service da
 * PCTEC Central de Serviços N1. Nunca browser-facing: montada atrás da
 * credencial e do header PRÓPRIOS da Central.
 *
 * Contrato mínimo e fechado na própria aplicação: nada aqui lê acesso ou
 * perfil de outro produto, lista pessoas ou expõe dado de autenticação.
 */
export function createServiceCentralServicosRoutes(service: CentralServicosService): Router {
  const router = Router();

  // GET /identities/:id/authorization — camadas 1 e 2 de ADR-007 para
  // PCTEC_CENTRAL_SERVICOS, e só para ela.
  router.get(
    "/identities/:identityPublicId/authorization",
    envolver(async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.status(200).json(await service.autorizacao(String(req.params["identityPublicId"])));
    })
  );

  // POST /delegation-assertions — uma asserção por ação, destinada ao
  // Helpdesk. O token volta só nesta resposta e nunca é gravado.
  router.post(
    "/delegation-assertions",
    envolver(async (req, res) => {
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      res.set("Cache-Control", "no-store");
      res.status(201).json(
        await service.emitirAssercao({
          identityPublicId: corpo["identityPublicId"],
          ticketId: corpo["ticketId"],
          idempotencyKey: corpo["idempotencyKey"],
          actionKind: corpo["actionKind"],
          contentSha256: corpo["contentSha256"],
          correlationId: req.correlationId
        })
      );
    })
  );

  return router;
}

/**
 * `POST /api/v1/service/helpdesk/delegation-assertions/verify` — o
 * DESTINATÁRIO confere e consome a asserção. Montada no namespace do
 * Helpdesk, com a credencial do Helpdesk: o destinatário é quem prova ter
 * recebido, e a audiência é fixada aqui, nunca lida do corpo.
 */
export function createServiceHelpdeskDelegationRoutes(service: CentralServicosService): Router {
  const router = Router();
  router.post(
    "/delegation-assertions/verify",
    envolver(async (req, res) => {
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      res.set("Cache-Control", "no-store");
      res.status(200).json(
        await service.verificarAssercao({
          assertion: corpo["assertion"],
          audience: AUDIENCE_HELPDESK,
          consumer: consumidorAutenticado(req) ?? AUDIENCE_HELPDESK,
          ticketId: corpo["ticketId"],
          idempotencyKey: corpo["idempotencyKey"],
          actionKind: corpo["actionKind"],
          contentSha256: corpo["contentSha256"],
          correlationId: req.correlationId
        })
      );
    })
  );
  return router;
}
