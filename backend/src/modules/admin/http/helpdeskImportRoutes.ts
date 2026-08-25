import { Router, type NextFunction, type Response } from "express";
import type { RequestWithAuthorization } from "../../authorization/http/requireApplicationAccess.js";
import type { GetHelpdeskCatalogService } from "../../import/application/GetHelpdeskCatalogService.js";
import {
  HelpdeskImportSelection,
  type HelpdeskImportSelectionInput
} from "../../import/domain/wizard/HelpdeskImportSelection.js";
import {
  WIZARD_APPLY_CONFIRMATION,
  type RunHelpdeskImportWizardService
} from "../../import/application/RunHelpdeskImportWizardService.js";
import { WIZARD_MAPPING_RULES_VERSION } from "../../import/domain/wizard/HelpdeskImportScope.js";
import { ImportItemSnapshot } from "../../import/domain/ImportItemSnapshot.js";
import {
  allowedSnapshotFieldsFor,
  type PlannedItem,
  type SnapshotFields
} from "../../import/domain/wizard/HelpdeskImportPlanner.js";

export interface HelpdeskImportApiDeps {
  readonly catalogService: GetHelpdeskCatalogService;
  readonly wizardService: RunHelpdeskImportWizardService;
}

/**
 * Rotas do assistente de importação Helpdesk → Ingressa.
 *
 * Montadas sob `/api/v1/admin`, que já exige, nesta ordem: sessão
 * autenticada → Identity ACTIVE → `ApplicationAccess(PCTEC_INGRESSA,
 * ADMIN)`. Estas rotas NÃO reimplementam nada disso; reimplementar
 * criaria uma segunda política de autorização que pode divergir da
 * primeira.
 *
 * O que elas acrescentam é a guarda de ORIGEM (CSRF), montada no router
 * inteiro em `createApp`, e a regra que dá nome à fatia:
 *
 *   **o ator de toda operação vem da SESSÃO, nunca do corpo.**
 *
 * Não existe campo `actorPublicId`, `approvedBy` ou equivalente em
 * nenhum payload aceito aqui. Se existisse, aprovar um apply em nome de
 * outro administrador seria uma linha de JSON.
 *
 * E a segunda regra, igualmente estrutural: **a UI manda seleção, não
 * decisão**. Nenhum payload carrega ação, escopo de membership, perfil
 * de acesso ou `publicId` de destino calculado no navegador. O plano é
 * recalculado no backend a cada chamada — na pré-visualização, no
 * dry-run e no apply.
 */
export function createHelpdeskImportRoutes(deps: HelpdeskImportApiDeps): Router {
  const router = Router();

  const envolver =
    (handler: (req: RequestWithAuthorization, res: Response) => Promise<void>) =>
    (req: RequestWithAuthorization, res: Response, next: NextFunction): void => {
      handler(req, res).catch(next);
    };

  /** O ator de toda operação é a identidade autenticada, nunca o corpo. */
  const ator = (req: RequestWithAuthorization): string => String(req.authorization?.identityPublicId ?? "");

  const erro = (res: Response, status: number, code: string, message: string): void => {
    res.status(status).json({ error: { code, message, details: [] } });
  };

  // ------------------------------------------------------------------
  // Etapa 1 e 2 — catálogo read-only da origem
  // ------------------------------------------------------------------

  router.get(
    "/companies",
    envolver(async (req, res) => {
      res.status(200).json(await deps.catalogService.listCompanies(req.query));
    })
  );

  router.get(
    "/companies/:sourceClientId/users",
    envolver(async (req, res) => {
      const clientId = idDeOrigem(req.params["sourceClientId"]);
      if (clientId === undefined) {
        erro(res, 422, "IMPORT_WIZARD_SOURCE_CLIENT_INVALID", "Empresa de origem inválida.");
        return;
      }
      res.status(200).json(await deps.catalogService.listUsers(clientId));
    })
  );

  // ------------------------------------------------------------------
  // Etapa 4 — mapeamento proposto, sem abrir lote
  // ------------------------------------------------------------------

  /**
   * Pré-visualização: mostra o plano SEM registrar nada.
   *
   * É POST, não GET, por dois motivos concretos: a seleção pode ter
   * centenas de ids e não cabe confortavelmente numa query string, e
   * uma URL com a seleção inteira vaza a lista para log de acesso,
   * histórico do navegador e Referer.
   *
   * Não abre lote e não grava item — é literalmente o mesmo cálculo do
   * dry-run, sem a parte que deixa rastro. Quem quiser rastro pede o
   * dry-run.
   */
  router.post(
    "/preview",
    envolver(async (req, res) => {
      const selecao = lerSelecao(req.body);
      if (selecao === undefined) {
        erro(res, 422, "IMPORT_WIZARD_SELECTION_INVALID", "Seleção inválida.");
        return;
      }
      const preparado = await deps.wizardService.prepare(HelpdeskImportSelection.create(selecao));
      res.status(200).json(toPreviewResponse(preparado));
    })
  );

  // ------------------------------------------------------------------
  // Etapa 5 e 6 — DRY_RUN
  // ------------------------------------------------------------------

  router.post(
    "/dry-run",
    envolver(async (req, res) => {
      const selecao = lerSelecao(req.body);
      if (selecao === undefined) {
        erro(res, 422, "IMPORT_WIZARD_SELECTION_INVALID", "Seleção inválida.");
        return;
      }
      const resultado = await deps.wizardService.execute({
        mode: "DRY_RUN",
        selection: HelpdeskImportSelection.create(selecao),
        actorIdentityPublicId: ator(req)
      });
      res.status(201).json(resultado);
    })
  );

  // ------------------------------------------------------------------
  // Etapa 8 e 9 — aprovação e APPLY
  // ------------------------------------------------------------------

  /**
   * APPLY.
   *
   * Três provas, todas revalidadas aqui e nenhuma delegada ao
   * navegador:
   *
   *  1. a confirmação literal `APLICAR`, comparada no serviço;
   *  2. o `dryRunBatchPublicId` de um lote DRY_RUN COMPLETED, sob a
   *     mesma versão de regras;
   *  3. o `scopeFingerprint` recalculado do zero, idêntico ao do
   *     dry-run — origem alterada, seleção alterada ou organização
   *     alterada mudam o hash e `ImportBatch.startApply` recusa.
   *
   * A aprovação e a execução são a MESMA requisição de propósito. Um
   * endpoint de "aprovar" separado criaria uma janela entre aprovar e
   * aplicar na qual a origem pode mudar — e o registro da aprovação já
   * existiria, afirmando que alguém autorizou o que acabou não sendo
   * executado.
   */
  router.post(
    "/apply",
    envolver(async (req, res) => {
      const corpo = (req.body ?? {}) as {
        readonly dryRunBatchPublicId?: unknown;
        readonly confirmation?: unknown;
      };
      const selecao = lerSelecao(req.body);
      if (selecao === undefined) {
        erro(res, 422, "IMPORT_WIZARD_SELECTION_INVALID", "Seleção inválida.");
        return;
      }
      const dryRun = typeof corpo.dryRunBatchPublicId === "string" ? corpo.dryRunBatchPublicId.trim() : "";
      if (dryRun.length === 0) {
        erro(res, 422, "IMPORT_WIZARD_DRY_RUN_REQUIRED", "Informe o lote de dry-run aprovado.");
        return;
      }

      const resultado = await deps.wizardService.execute({
        mode: "APPLY",
        selection: HelpdeskImportSelection.create(selecao),
        actorIdentityPublicId: ator(req),
        dryRunBatchPublicId: dryRun,
        confirmation: typeof corpo.confirmation === "string" ? corpo.confirmation : undefined
      });
      res.status(201).json(resultado);
    })
  );

  return router;
}

function idDeOrigem(valor: unknown): number | undefined {
  const numero = Number(typeof valor === "string" ? valor.trim() : valor);
  return Number.isInteger(numero) && numero > 0 ? numero : undefined;
}

/**
 * Extrai APENAS os quatro campos que compõem uma seleção.
 *
 * Lista fechada, não `...body`: um corpo com campos a mais é aceito e
 * os extras são descartados aqui, na fronteira, em vez de viajarem
 * junto até algum ponto que resolva ler um deles.
 */
function lerSelecao(body: unknown): HelpdeskImportSelectionInput | undefined {
  if (body === null || typeof body !== "object") {
    return undefined;
  }
  const corpo = body as Record<string, unknown>;
  return {
    sourceClientId: corpo["sourceClientId"],
    selectedSourceUserIds: corpo["selectedSourceUserIds"],
    targetOrganizationPublicId: corpo["targetOrganizationPublicId"],
    parentBusinessGroupPublicId: corpo["parentBusinessGroupPublicId"]
  };
}

/**
 * Resposta da pré-visualização.
 *
 * Monta a partir do plano JÁ CALCULADO, com os mesmos snapshots que
 * iriam para o lote — a tela mostra exatamente o que o dry-run
 * registraria, não uma aproximação montada para exibição.
 */
/**
 * Snapshot da pré-visualização passa pela MESMA redação do relatório.
 *
 * Os campos já vêm de whitelist do planner, então nada sensível
 * deveria estar lá — e é exatamente por isso que a redação é aplicada
 * mesmo assim. Uma whitelist futura que ganhe um campo indevido é
 * corrigida num lugar só (`ImportItemSnapshot`), e a tela não é a
 * exceção que escapou da política.
 */
function redigir(
  entityKind: string,
  campos: SnapshotFields | undefined
): { fields: Record<string, unknown>; redactedFields: readonly string[] } | null {
  if (campos === undefined) {
    return null;
  }
  return ImportItemSnapshot.fromWhitelist(allowedSnapshotFieldsFor(entityKind), { ...campos }).toRedactedJSON();
}

function toItemResponse(item: PlannedItem): Record<string, unknown> {
  return {
    entityKind: item.entityKind,
    action: item.action,
    reasonCode: item.reasonCode,
    before: redigir(item.entityKind, item.before),
    after: redigir(item.entityKind, item.after)
  };
}

function toPreviewResponse(
  preparado: Awaited<ReturnType<RunHelpdeskImportWizardService["prepare"]>>
): Record<string, unknown> {
  const { cliente, target, plano, selection } = preparado;
  return {
    mappingRulesVersion: WIZARD_MAPPING_RULES_VERSION,
    applyConfirmationWord: WIZARD_APPLY_CONFIRMATION,
    source: {
      sourceClientId: cliente.id,
      name: cliente.name,
      active: cliente.active
    },
    organization: {
      resolution: target.resolvedOrganization.kind,
      publicId: target.resolvedOrganization.organization?.publicId ?? null,
      legalName: target.resolvedOrganization.organization?.legalName ?? cliente.name,
      type: target.resolvedOrganization.organization?.type ?? "COMPANY",
      status: target.resolvedOrganization.organization?.status ?? null,
      assertionConflict: target.resolvedOrganization.assertionConflict ?? null,
      blockingReasonCode: plano.organization.blockingReasonCode ?? null,
      actions: plano.organization.items.map(toItemResponse)
    },
    businessGroup:
      target.businessGroup === undefined
        ? null
        : {
            publicId: target.businessGroup.publicId,
            legalName: target.businessGroup.organization?.legalName ?? null,
            eligible: target.businessGroup.eligible,
            ineligibleReason: target.businessGroup.ineligibleReason ?? null,
            existingRelationshipPublicId: target.businessGroup.existingRelationship?.publicId ?? null
          },
    selection: {
      sourceClientId: selection.getSourceClientId(),
      selectedSourceUserIds: selection.getSelectedSourceUserIds()
    },
    countsByAction: plano.countsByAction,
    writes: plano.writes,
    users: plano.users.map((usuario) => ({
      sourceLegacyId: usuario.sourceLegacyId,
      name: usuario.sourceName,
      email: usuario.sourceEmail,
      linkKind: usuario.linkKind,
      writes: usuario.writes,
      existingIdentityPublicId: usuario.existingIdentityPublicId ?? null,
      items: usuario.items.map(toItemResponse)
    }))
  };
}
