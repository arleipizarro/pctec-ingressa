import { Router, type NextFunction, type Request, type Response } from "express";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import type { MeuRhDirectoryService } from "../application/MeuRhDirectoryService.js";
import { MeuRhOrganizationNotFoundError } from "../application/errors/MeuRhErrors.js";

/**
 * Namespace service-to-service do PCTEC Meu RH.
 *
 * NUNCA browser-facing: montado atrás de `requireServiceCredential` com
 * o header e o segredo PRÓPRIOS do Meu RH, e nenhum caminho de código o
 * monta sob um namespace que aceite cookie de sessão. Um navegador não
 * chega aqui.
 *
 * Contrato mínimo, deliberadamente: só as operações sem as quais o Meu
 * RH precisaria de uma segunda tabela de identidade. Nada de listagem
 * genérica de identidades, nada de busca livre no diretório global e
 * nada que exponha `id` interno, credencial ou dado de autenticação.
 */

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export function createServiceMeuRhRoutes(service: MeuRhDirectoryService): Router {
  const router = Router();

  const envolver =
    (manipulador: (req: RequestWithCorrelationId, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      manipulador(req as RequestWithCorrelationId, res).catch(next);
    };

  // POST /organizations/ensure — resolve a empresa pelo nome, criando-a
  // se não existir. Idempotente; `created` diz o que aconteceu.
  router.post(
    "/organizations/ensure",
    envolver(async (req, res) => {
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      const legalName = texto(corpo["legalName"]);
      if (legalName.length === 0) {
        throw new MeuRhOrganizationNotFoundError("(nome não informado)");
      }
      // `alsoKnownAs` chega como lista de texto; qualquer coisa fora
      // disso vira lista vazia em vez de quebrar — o campo é opcional e
      // um cliente que o envie errado deve perder o apelido, não a
      // resolução inteira.
      const apelidos = Array.isArray(corpo["alsoKnownAs"])
        ? (corpo["alsoKnownAs"] as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
      const resultado = await service.garantirOrganizacao({
        legalName,
        ...(apelidos.length > 0 ? { alsoKnownAs: apelidos } : {}),
        tradeName: texto(corpo["tradeName"]).length > 0 ? texto(corpo["tradeName"]) : undefined,
        actorPublicId: texto(corpo["actorPublicId"]).length > 0 ? texto(corpo["actorPublicId"]) : undefined,
        correlationId: req.correlationId
      });
      res.status(200).json(resultado);
    })
  );

  // GET /identities/by-email/:email — reconciliação. Devolve `null` em
  // 200 quando não existe: "não achei" é resposta bem-sucedida a uma
  // pergunta de reconciliação, não um 404.
  router.get(
    "/identities/by-email/:email",
    envolver(async (req, res) => {
      const identity = await service.identidadePorEmail(decodeURIComponent(req.params["email"] as string));
      res.status(200).json({ identity });
    })
  );

  router.get(
    "/identities/:identityPublicId",
    envolver(async (req, res) => {
      const identity = await service.identidade(req.params["identityPublicId"] as string);
      res.status(200).json({ identity });
    })
  );

  // GET /identities/:id/access-profile — camada 1 de ADR-007. O Meu RH
  // consulta isto para saber se a pessoa ainda pode entrar no produto;
  // as permissões finas de RH continuam no banco dele.
  router.get(
    "/identities/:identityPublicId/access-profile",
    envolver(async (req, res) => {
      const accessProfile = await service.perfilDeAcesso(req.params["identityPublicId"] as string);
      res.status(200).json({ accessProfile });
    })
  );

  router.get(
    "/organizations/:organizationPublicId/identities",
    envolver(async (req, res) => {
      const identities = await service.diretorio(req.params["organizationPublicId"] as string);
      res.status(200).json({ identities });
    })
  );

  // POST /collaborators/ensure — identidade + vínculo + acesso, numa
  // transação, de forma idempotente.
  router.post(
    "/collaborators/ensure",
    envolver(async (req, res) => {
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      const resultado = await service.garantirColaborador({
        organizationPublicId: texto(corpo["organizationPublicId"]),
        fullName: texto(corpo["fullName"]),
        email: texto(corpo["email"]),
        accessProfile: texto(corpo["accessProfile"]).length > 0 ? texto(corpo["accessProfile"]) : undefined,
        actorPublicId: texto(corpo["actorPublicId"]).length > 0 ? texto(corpo["actorPublicId"]) : undefined,
        correlationId: req.correlationId
      });
      res.status(200).json(resultado);
    })
  );

  router.post(
    "/memberships/status",
    envolver(async (req, res) => {
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      const status = texto(corpo["status"]);
      if (status !== "ACTIVE" && status !== "INACTIVE") {
        throw new MeuRhOrganizationNotFoundError("(situação inválida)");
      }
      const resultado = await service.definirSituacaoDoVinculo({
        identityPublicId: texto(corpo["identityPublicId"]),
        organizationPublicId: texto(corpo["organizationPublicId"]),
        status,
        reason: texto(corpo["reason"]).length > 0 ? texto(corpo["reason"]) : undefined,
        actorPublicId: texto(corpo["actorPublicId"]).length > 0 ? texto(corpo["actorPublicId"]) : undefined,
        correlationId: req.correlationId
      });
      res.status(200).json(resultado);
    })
  );

  return router;
}
