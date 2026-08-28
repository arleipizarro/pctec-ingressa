import { Router, type NextFunction, type Response } from "express";
import type { RequestWithAuthorization } from "../../authorization/http/requireApplicationAccess.js";
import type { SearchPortalClientCatalogService } from "../../portal/application/SearchPortalClientCatalogService.js";
import type { GetPortalOrganizationMatchService } from "../../portal/application/GetPortalOrganizationMatchService.js";
import type { ReconcilePortalOrganizationReferencesService } from "../../portal/application/ReconcilePortalOrganizationReferencesService.js";
import { PORTAL_RECONCILIATION_CONFIRMATION } from "../../portal/application/ReconcilePortalOrganizationReferencesService.js";
import { createRequireSafeOrigin } from "../../security/http/requireSafeOrigin.js";

export interface PortalCatalogApiDeps {
  readonly catalogService: SearchPortalClientCatalogService;
  readonly matchService: GetPortalOrganizationMatchService;
  readonly reconciliationService: ReconcilePortalOrganizationReferencesService;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Catálogo administrativo do Portal — o que substitui "descobrir o
 * `clientes.id` no SQL".
 *
 * Montadas sob `/api/v1/admin/portal-catalog`, que já exige, nesta
 * ordem: sessão autenticada → Identity ACTIVE →
 * `ApplicationAccess(PCTEC_INGRESSA, ADMIN)`. Estas rotas NÃO
 * reimplementam nada disso — reimplementar criaria uma segunda política
 * de autorização, que diverge da primeira no primeiro ajuste.
 *
 * O prefixo próprio existe pelo mesmo motivo do assistente de
 * importação: a fonte do Portal pode não estar configurada neste
 * processo, e nesse caso o router INTEIRO responde 503 com código
 * próprio, sem derrubar login, `/admin/organizations` ou qualquer outra
 * coisa que não dependa do Portal.
 *
 * ## O que estas rotas NÃO fazem
 *
 * **Nenhuma delas cria vínculo.** A busca mostra candidatos; a
 * correspondência mostra uma sugestão. Criar a referência continua
 * sendo `POST /admin/organizations/:publicId/portal-reference`, do PR
 * anterior, com o `FOR UPDATE`, a idempotência e a auditoria de lá. A
 * única exceção é a execução da reconciliação — e ela também escreve
 * por aquele mesmo serviço, uma transação por organização.
 *
 * **Nenhuma delas aceita `systemCode` ou `entityType` do navegador.**
 * Os dois são fixos no servidor; aceitá-los daria a esta tela o poder
 * genérico do CLI de referências externas.
 *
 * **Nenhuma delas devolve documento inteiro.** O que sai é a máscara
 * `**.***.678/0001-95` — o bastante para o ADMIN distinguir filiais,
 * insuficiente para virar uma cópia do cadastro do Portal.
 */
export function createPortalCatalogRoutes(deps: PortalCatalogApiDeps, allowedOrigins: readonly string[]): Router {
  const router = Router();
  const origemSegura = createRequireSafeOrigin(allowedOrigins);

  const envolver =
    (handler: (req: RequestWithAuthorization, res: Response) => Promise<void>) =>
    (req: RequestWithAuthorization, res: Response, next: NextFunction): void => {
      handler(req, res).catch(next);
    };

  const erro = (res: Response, status: number, code: string, message: string): void => {
    res.status(status).json({ error: { code, message, details: [] } });
  };

  /** O ator de toda escrita é a identidade autenticada, nunca o corpo. */
  const ator = (req: RequestWithAuthorization): string => String(req.authorization?.identityPublicId ?? "");

  /**
   * Busca administrativa no catálogo do Portal.
   *
   * `q` aceita nome, nome fantasia ou um CNPJ. Quando o termo é um
   * CNPJ, a comparação é EXATA — é a mesma do vínculo automático. Nos
   * demais casos é textual, e existe só para o ADMIN ENXERGAR
   * candidatos: nenhum resultado desta rota vira vínculo sem uma
   * seleção explícita depois.
   *
   * O limite é pequeno e sempre aplicado, mesmo sem `limit` no query
   * string: esta tela escolhe UM cliente, não navega o cadastro do
   * Portal.
   */
  router.get(
    "/clients",
    envolver(async (req, res) => {
      res.status(200).json(await deps.catalogService.execute(req.query));
    })
  );

  /**
   * Correspondência automática desta organização — leitura pura.
   *
   * `EXACT_UNIQUE` traz a sugestão pronta para confirmação. Qualquer
   * outro estado traz só a classificação, e a tela cai na busca
   * manual. Nada é escrito por esta rota.
   */
  router.get(
    "/organizations/:publicId/match",
    envolver(async (req, res) => {
      const publicId = req.params["publicId"];
      if (typeof publicId !== "string" || !UUID.test(publicId)) {
        erro(res, 422, "ORGANIZATION_PUBLIC_ID_INVALID", "publicId inválido.");
        return;
      }
      res.status(200).json(await deps.matchService.execute(publicId));
    })
  );

  /**
   * Reconciliação — dry-run.
   *
   * É `GET` porque não escreve **nada**: nem referência, nem lote, nem
   * evento. O método é parte do contrato aqui — um `POST` diria que
   * algo acontece, e a promessa desta rota é que não acontece.
   */
  router.get(
    "/reconciliation/dry-run",
    envolver(async (req, res) => {
      res.status(200).json(await deps.reconciliationService.dryRun(req.query));
    })
  );

  /**
   * Reconciliação — execução.
   *
   * Separada do dry-run, com `origemSegura`, confirmação literal
   * `RECONCILIAR` e a lista explícita de organizações que o ADMIN
   * acabou de ver. Não existe "reconciliar tudo", e cada organização é
   * reclassificada do zero antes de qualquer escrita.
   */
  router.post(
    "/reconciliation/execute",
    origemSegura,
    envolver(async (req, res) => {
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      const resultado = await deps.reconciliationService.execute({
        organizationPublicIds: corpo["organizationPublicIds"],
        confirmation: corpo["confirmation"],
        actorPublicId: ator(req),
        correlationId: req.correlationId
      });
      res.status(200).json({ ...resultado, confirmationWord: PORTAL_RECONCILIATION_CONFIRMATION });
    })
  );

  return router;
}
