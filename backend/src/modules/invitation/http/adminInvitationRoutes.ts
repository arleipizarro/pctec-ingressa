import { Router, type NextFunction, type Response } from "express";
import type { RequestWithAuthorization } from "../../authorization/http/requireApplicationAccess.js";
import type { CreateIdentityInvitationService } from "../application/CreateIdentityInvitationService.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Teto de itens por lote. Não é uma regra de negócio: é o limite acima
 * do qual uma requisição vira um trabalho em lote de verdade (com fila e
 * acompanhamento), e não uma chamada síncrona de tela.
 */
const MAX_IDENTITIES_POR_LOTE = 100;

/**
 * `POST /api/v1/admin/invitations` — emissão administrativa de convites.
 *
 * Montada na MESMA cadeia de `/api/v1/admin` (sessão → Identity ACTIVE →
 * ADMIN em PCTEC_INGRESSA) MAIS a guarda de origem, pelo mesmo motivo do
 * assistente de importação: é uma rota MUTÁVEL autenticada por cookie.
 *
 * O ator é `req.authorization.identityPublicId` — nunca um campo do
 * corpo. Quem convidou é quem está autenticado, e ponto.
 */
export function createAdminInvitationRoutes(
  createIdentityInvitationService: CreateIdentityInvitationService
): Router {
  const router = Router();

  router.post("/", (req: RequestWithAuthorization, res: Response, next: NextFunction) => {
    const body = req.body as Record<string, unknown> | undefined;
    const bruto = body?.["identityPublicIds"];
    if (!Array.isArray(bruto) || bruto.length === 0) {
      res.status(422).json({
        error: {
          code: "INVITATION_SELECTION_INVALID",
          message: "Informe ao menos uma identidade.",
          correlation_id: req.correlationId ?? null,
          details: []
        }
      });
      return;
    }
    if (bruto.length > MAX_IDENTITIES_POR_LOTE) {
      res.status(422).json({
        error: {
          code: "INVITATION_SELECTION_TOO_LARGE",
          message: `Selecione no máximo ${MAX_IDENTITIES_POR_LOTE} identidades por vez.`,
          correlation_id: req.correlationId ?? null,
          details: []
        }
      });
      return;
    }

    // publicId malformado é recusado ANTES de qualquer acesso ao banco —
    // mesmo critério de `adminApiRoutes.publicIdDaRota`.
    const identityPublicIds = bruto.filter((valor): valor is string => typeof valor === "string" && UUID.test(valor));
    if (identityPublicIds.length !== bruto.length) {
      res.status(422).json({
        error: {
          code: "IDENTITY_PUBLIC_ID_INVALID",
          message: "Há identificadores inválidos na seleção.",
          correlation_id: req.correlationId ?? null,
          details: []
        }
      });
      return;
    }

    const invitedByPublicId = req.authorization?.identityPublicId;
    if (invitedByPublicId === undefined) {
      res.status(403).json({
        error: {
          code: "APPLICATION_ACCESS_DENIED",
          message: "Acesso negado a esta aplicação.",
          correlation_id: req.correlationId ?? null,
          details: []
        }
      });
      return;
    }

    createIdentityInvitationService
      .execute({ identityPublicIds, invitedByPublicId, correlationId: req.correlationId })
      .then((resultado) => {
        res.status(201).json(resultado);
      })
      .catch(next);
  });

  return router;
}
