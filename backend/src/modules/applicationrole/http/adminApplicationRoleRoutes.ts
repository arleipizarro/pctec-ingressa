import { Router, type NextFunction, type Response } from "express";
import type { RequestWithAuthorization } from "../../authorization/http/requireApplicationAccess.js";
import { createRequireSafeOrigin } from "../../security/http/requireSafeOrigin.js";
import type { ApplicationRoleService } from "../application/ApplicationRoleService.js";

/**
 * Administração dos PERFIS DE APLICAÇÃO, no namespace `/api/v1/admin`.
 *
 * Montada sob a MESMA cadeia do resto da administração — sessão válida
 * e `ApplicationAccess(PCTEC_INGRESSA, ADMIN)` — e é isso que responde à
 * regra "o responsável pelo RH não administra a plataforma": quem não é
 * administrador do Ingressa não chega a estas rotas, com ou sem perfil
 * no produto consumidor.
 *
 * As telas de produto (ex.: "Perfis" no Meu RH) NÃO passam por aqui:
 * elas falam com o namespace service-to-service do próprio produto, que
 * aplica a política DELE. Os dois caminhos escrevem na mesma tabela,
 * pela mesma classe de serviço — nunca duas implementações da mesma
 * concessão.
 *
 * `origemSegura` rota a rota, e não no router: no router, um método
 * mutável para um caminho inexistente responderia 403 em vez do 404
 * correto. Mesmo critério já registrado em `adminApiRoutes`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO = /^[A-Z][A-Z0-9_]{1,63}$/;

function erro(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message, details: [] } });
}

export function createAdminApplicationRoleRoutes(
  service: ApplicationRoleService,
  allowedOrigins: readonly string[]
): Router {
  const router = Router();
  const origemSegura = createRequireSafeOrigin(allowedOrigins);
  const envolver =
    (handler: (req: RequestWithAuthorization, res: Response) => Promise<void>) =>
    (req: RequestWithAuthorization, res: Response, next: NextFunction): void => {
      handler(req, res).catch(next);
    };

  function codigoDaAplicacao(req: RequestWithAuthorization): string | undefined {
    const valor = req.params["applicationCode"];
    return typeof valor === "string" && CODIGO.test(valor) ? valor : undefined;
  }

  /**
   * Catálogo + concessões de uma aplicação, numa resposta só.
   *
   * Juntos porque a tela precisa dos dois ao mesmo tempo: "o perfil X
   * inclui estas permissões E estas pessoas o têm" é uma leitura, não
   * duas. Em duas requisições, a tela mostraria por um instante um
   * perfil sem ninguém e um "ninguém" que era só o segundo request
   * ainda voando.
   */
  router.get(
    "/applications/:applicationCode/roles",
    envolver(async (req, res) => {
      const applicationCode = codigoDaAplicacao(req);
      if (applicationCode === undefined) {
        erro(res, 422, "APPLICATION_CODE_INVALID", "Código de aplicação inválido.");
        return;
      }
      const [roles, grants] = await Promise.all([
        service.catalogo(applicationCode),
        service.concessoes(applicationCode)
      ]);
      res.status(200).json({
        roles: roles.map((perfil) => ({
          ...perfil,
          members: grants
            .filter((concessao) => concessao.roleCode === perfil.code)
            .map((concessao) => ({
              assignmentPublicId: concessao.publicId,
              identityPublicId: concessao.identityPublicId,
              fullName: concessao.fullName,
              email: concessao.email,
              grantedAt: concessao.grantedAt,
              grantedBy: concessao.grantedByFullName ?? concessao.grantedByLabel
            }))
        }))
      });
    })
  );

  /** Perfis de UMA pessoa numa aplicação — usado na tela de detalhes da identidade. */
  router.get(
    "/identities/:publicId/application-roles/:applicationCode",
    envolver(async (req, res) => {
      const publicId = req.params["publicId"];
      const applicationCode = codigoDaAplicacao(req);
      if (typeof publicId !== "string" || !UUID.test(publicId) || applicationCode === undefined) {
        erro(res, 422, "REQUEST_INVALID", "Identificador de identidade ou de aplicação inválido.");
        return;
      }
      const [catalogo, concedidos] = await Promise.all([
        service.catalogo(applicationCode),
        service.concessoesDaPessoa(publicId, applicationCode)
      ]);
      res.status(200).json({
        roles: catalogo.map((perfil) => {
          const concessao = concedidos.find((item) => item.roleCode === perfil.code);
          return {
            ...perfil,
            granted: concessao !== undefined,
            grantedAt: concessao?.grantedAt ?? null,
            grantedBy: concessao?.grantedByFullName ?? concessao?.grantedByLabel ?? null
          };
        })
      });
    })
  );

  router.post(
    "/identities/:publicId/application-roles",
    origemSegura,
    envolver(async (req, res) => {
      const publicId = req.params["publicId"];
      if (typeof publicId !== "string" || !UUID.test(publicId)) {
        erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
        return;
      }
      const corpo = (req.body ?? {}) as { applicationCode?: unknown; roleCode?: unknown };
      const applicationCode = typeof corpo.applicationCode === "string" ? corpo.applicationCode : "";
      const roleCode = typeof corpo.roleCode === "string" ? corpo.roleCode : "";
      if (!CODIGO.test(applicationCode) || !CODIGO.test(roleCode)) {
        erro(res, 422, "REQUEST_INVALID", "applicationCode e roleCode são obrigatórios.");
        return;
      }
      const resultado = await service.conceder({
        identityPublicId: publicId,
        applicationCode,
        roleCode,
        grantedByIdentityPublicId: String(req.authorization?.identityPublicId ?? "")
      });
      res.status(resultado.changed ? 201 : 200).json(resultado);
    })
  );

  router.post(
    "/identities/:publicId/application-roles/revoke",
    origemSegura,
    envolver(async (req, res) => {
      const publicId = req.params["publicId"];
      if (typeof publicId !== "string" || !UUID.test(publicId)) {
        erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
        return;
      }
      const corpo = (req.body ?? {}) as { applicationCode?: unknown; roleCode?: unknown };
      const applicationCode = typeof corpo.applicationCode === "string" ? corpo.applicationCode : "";
      const roleCode = typeof corpo.roleCode === "string" ? corpo.roleCode : "";
      if (!CODIGO.test(applicationCode) || !CODIGO.test(roleCode)) {
        erro(res, 422, "REQUEST_INVALID", "applicationCode e roleCode são obrigatórios.");
        return;
      }
      res.status(200).json(
        await service.revogar({
          identityPublicId: publicId,
          applicationCode,
          roleCode,
          revokedByIdentityPublicId: String(req.authorization?.identityPublicId ?? "")
        })
      );
    })
  );

  return router;
}
