import { Router, type NextFunction, type Request, type Response } from "express";
import type { RequestWithCorrelationId } from "../../../shared/http/correlationId.js";
import type { MeuRhDirectoryService } from "../application/MeuRhDirectoryService.js";
import type { ApplicationRoleService } from "../../applicationrole/application/ApplicationRoleService.js";
import { PCTEC_MEU_RH_APPLICATION_CODE } from "../../application/domain/value-objects/ApplicationCodes.js";
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

const CODIGO_DE_PERFIL = /^[A-Z][A-Z0-9_]{1,63}$/;

export function createServiceMeuRhRoutes(
  service: MeuRhDirectoryService,
  roleService: ApplicationRoleService
): Router {
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

  // GET /identities/:id/access-profile — as DUAS camadas de ADR-007
  // numa resposta só.
  //
  // `accessProfile` é a camada 1: a pessoa ainda pode ENTRAR no produto?
  // `roles` é a camada 2: quais perfis ela tem DENTRO dele, segundo o
  // catálogo desta aplicação. A partir da Etapa 2 os perfis são
  // concedidos e guardados AQUI, e o Meu RH deixa de manter uma segunda
  // lista própria — duas listas seriam duas verdades, e a segunda
  // discorda da primeira no dia em que alguém esquece de atualizar uma.
  //
  // O que cada perfil LIBERA continua sendo do Meu RH, em código
  // revisado em pull request. Este endpoint entrega os códigos, nunca a
  // interpretação deles.
  //
  // `roles` só vem quando há acesso: sem camada 1, a camada 2 não
  // significa nada, e devolvê-la convidaria um consumidor distraído a
  // usar perfil sem conferir acesso.
  router.get(
    "/identities/:identityPublicId/access-profile",
    envolver(async (req, res) => {
      const identityPublicId = req.params["identityPublicId"] as string;
      const accessProfile = await service.perfilDeAcesso(identityPublicId);
      const roles =
        accessProfile === null
          ? []
          : await roleService.perfisConcedidos(identityPublicId, PCTEC_MEU_RH_APPLICATION_CODE);
      res.status(200).json({ accessProfile, roles });
    })
  );

  // GET /roles — catálogo de perfis do Meu RH (código, nome, descrição
  // e permissões declaradas), para a tela de administração do produto.
  router.get(
    "/roles",
    envolver(async (_req, res) => {
      res.status(200).json({ roles: await roleService.catalogo(PCTEC_MEU_RH_APPLICATION_CODE) });
    })
  );

  // GET /roles/grants — quem tem qual perfil, com quem concedeu e
  // quando. É a lista que a administração do produto exibe.
  router.get(
    "/roles/grants",
    envolver(async (_req, res) => {
      const grants = await roleService.concessoes(PCTEC_MEU_RH_APPLICATION_CODE);
      res.status(200).json({
        grants: grants.map((concessao) => ({
          assignmentPublicId: concessao.publicId,
          identityPublicId: concessao.identityPublicId,
          roleCode: concessao.roleCode,
          fullName: concessao.fullName,
          email: concessao.email,
          grantedAt: concessao.grantedAt,
          grantedBy: concessao.grantedByFullName ?? concessao.grantedByLabel
        }))
      });
    })
  );

  // POST /identities/:id/roles — concede. Idempotente: `changed: false`
  // quando o perfil já valia.
  //
  // QUEM PODE CONCEDER é decidido pelo Meu RH, antes de chamar: é lá que
  // mora a política de "responsável pelo RH não concede super admin" e
  // "ninguém altera a própria permissão". Aqui a fronteira confere o que
  // é dela — perfil existe no catálogo, pessoa tem acesso à aplicação —
  // e recusa o resto.
  router.post(
    "/identities/:identityPublicId/roles",
    envolver(async (req, res) => {
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      const roleCode = texto(corpo["roleCode"]);
      if (!CODIGO_DE_PERFIL.test(roleCode)) {
        throw new MeuRhOrganizationNotFoundError("(perfil inválido)");
      }
      const ator = texto(corpo["actorPublicId"]);
      res.status(200).json(
        await roleService.conceder({
          identityPublicId: req.params["identityPublicId"] as string,
          applicationCode: PCTEC_MEU_RH_APPLICATION_CODE,
          roleCode,
          ...(ator.length > 0 ? { grantedByIdentityPublicId: ator } : { grantedByLabel: texto(corpo["actorLabel"]) || "RECONCILIACAO" }),
          correlationId: req.correlationId
        })
      );
    })
  );

  router.post(
    "/identities/:identityPublicId/roles/revoke",
    envolver(async (req, res) => {
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      const roleCode = texto(corpo["roleCode"]);
      if (!CODIGO_DE_PERFIL.test(roleCode)) {
        throw new MeuRhOrganizationNotFoundError("(perfil inválido)");
      }
      const ator = texto(corpo["actorPublicId"]);
      res.status(200).json(
        await roleService.revogar({
          identityPublicId: req.params["identityPublicId"] as string,
          applicationCode: PCTEC_MEU_RH_APPLICATION_CODE,
          roleCode,
          ...(ator.length > 0 ? { revokedByIdentityPublicId: ator } : {}),
          correlationId: req.correlationId
        })
      );
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
