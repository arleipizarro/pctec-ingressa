import { Router, type Response, type NextFunction } from "express";
import type { RequestWithAuthorization } from "../../authorization/http/requireApplicationAccess.js";
import { ImportItemSnapshot } from "../../import/domain/ImportItemSnapshot.js";
import type { MariaDbAdminReadRepository } from "../infrastructure/persistence/MariaDbAdminReadRepository.js";
import type { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import type { RevokeApplicationAccessService } from "../../application/application/RevokeApplicationAccessService.js";
import type { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import type { EndMembershipService } from "../../organization/application/EndMembershipService.js";
import type { ActivateFederatedIdentityService } from "../../helpdesk/application/ActivateFederatedIdentityService.js";
import type { RenameOrganizationService } from "../../organization/application/RenameOrganizationService.js";

export interface AdminApiDeps {
  readonly readRepository: MariaDbAdminReadRepository;
  readonly grantApplicationAccessService: GrantApplicationAccessService;
  readonly revokeApplicationAccessService: RevokeApplicationAccessService;
  readonly createMembershipService: CreateMembershipService;
  readonly endMembershipService: EndMembershipService;
  readonly activateFederatedIdentityService: ActivateFederatedIdentityService;
  readonly renameOrganizationService: RenameOrganizationService;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `publicId` malformado responde 422 e NUNCA chega ao banco. Além de
 * validar entrada, isto fecha a porta de enumeração por erro: id
 * inválido e id inexistente respondem coisas diferentes só quando a
 * diferença é legítima.
 */
function publicIdDaRota(req: RequestWithAuthorization, nome: string): string | undefined {
  const valor = req.params[nome];
  return typeof valor === "string" && UUID.test(valor) ? valor : undefined;
}

function erro(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message, details: [] } });
}

function naoEncontrado(res: Response, recurso: string): void {
  erro(res, 404, "NOT_FOUND", `${recurso} não encontrado.`);
}

/** O ator de toda mutação é a identidade autenticada, nunca o corpo. */
function atorAutenticado(req: RequestWithAuthorization): string {
  return String(req.authorization?.identityPublicId ?? "");
}

/**
 * Snapshots de importação saem SEMPRE redigidos.
 *
 * `toRedactedJSON` troca por marcador qualquer campo que a política
 * ATUAL repreenda e devolve os nomes redigidos — quem audita vê que
 * havia ali um campo sensível, sem receber o valor. É a mesma função
 * usada pelo relatório do importador; a UI não reimplementa política de
 * sigilo.
 */
function redigirSnapshot(bruto: unknown): { fields: Record<string, unknown>; redactedFields: readonly string[] } | null {
  if (bruto === null || bruto === undefined) {
    return null;
  }
  const objeto = typeof bruto === "string" ? (JSON.parse(bruto) as Record<string, unknown>) : (bruto as Record<string, unknown>);
  return ImportItemSnapshot.fromPersistedRecord(objeto).toRedactedJSON();
}

export function createAdminApiRoutes(deps: AdminApiDeps): Router {
  const router = Router();
  const envolver = (handler: (req: RequestWithAuthorization, res: Response) => Promise<void>) =>
    (req: RequestWithAuthorization, res: Response, next: NextFunction): void => {
      handler(req, res).catch(next);
    };

  // ------------------------------------------------------------------
  // Leitura
  // ------------------------------------------------------------------
  router.get("/summary", envolver(async (req, res) => {
    res.status(200).json(await deps.readRepository.resumo());
  }));

  router.get("/applications", envolver(async (_req, res) => {
    res.status(200).json({ items: await deps.readRepository.listarAplicacoes() });
  }));

  router.get("/identities", envolver(async (req, res) => {
    res.status(200).json(await deps.readRepository.listarIdentidades(req.query));
  }));

  router.get("/identities/:publicId", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const detalhe = await deps.readRepository.detalharIdentidade(publicId);
    if (detalhe === undefined) {
      naoEncontrado(res, "Identidade");
      return;
    }
    res.status(200).json(detalhe);
  }));

  router.get("/organizations", envolver(async (req, res) => {
    res.status(200).json(await deps.readRepository.listarOrganizacoes(req.query));
  }));

  router.get("/organizations/:publicId", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "ORGANIZATION_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const detalhe = await deps.readRepository.detalharOrganizacao(publicId);
    if (detalhe === undefined) {
      naoEncontrado(res, "Organização");
      return;
    }
    res.status(200).json(detalhe);
  }));

  router.get("/import-batches", envolver(async (req, res) => {
    res.status(200).json(await deps.readRepository.listarLotes(req.query));
  }));

  router.get("/import-batches/:publicId/items", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "IMPORT_BATCH_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const pagina = await deps.readRepository.listarItensDoLote(publicId, req.query);
    res.status(200).json({
      ...pagina,
      items: pagina.items.map((item) => ({
        ...item,
        before_snapshot: redigirSnapshot(item["before_snapshot"]),
        after_snapshot: redigirSnapshot(item["after_snapshot"])
      }))
    });
  }));

  // ------------------------------------------------------------------
  // Mutações — toda regra vive no Application Service correspondente.
  // ------------------------------------------------------------------
  router.post("/identities/:publicId/activate-federated", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const detalhe = await deps.readRepository.detalharIdentidade(publicId);
    if (detalhe === undefined) {
      naoEncontrado(res, "Identidade");
      return;
    }

    // A ativação federada é resolvida pelo VÍNCULO, não pelo publicId:
    // o serviço exige uma IdentityExternalReference ACTIVE e é ela que
    // prova que esta identidade veio de um sistema externo.
    const referencias = (detalhe["externalReferences"] ?? []) as { system_code: string; entity_type: string; legacy_id: number; status: string }[];
    const federada = referencias.find((r) => r.status === "ACTIVE" && r.system_code === "PCTEC_HELPDESK" && r.entity_type === "users");
    if (federada === undefined) {
      erro(res, 409, "IDENTITY_NOT_FEDERATED", "Identidade sem vínculo federado ACTIVE do PCTEC_HELPDESK.");
      return;
    }

    const resultado = await deps.activateFederatedIdentityService.execute({
      legacyUserId: federada.legacy_id,
      approvedByIdentityPublicId: atorAutenticado(req)
    });
    res.status(200).json(resultado);
  }));

  router.post("/identities/:publicId/application-accesses", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const corpo = (req.body ?? {}) as { applicationCode?: string; accessProfile?: string };
    const resultado = await deps.grantApplicationAccessService.execute({
      identityPublicId: publicId,
      applicationCode: String(corpo.applicationCode ?? ""),
      accessProfile: String(corpo.accessProfile ?? ""),
      grantedByIdentityPublicId: atorAutenticado(req)
    });
    res.status(201).json(resultado);
  }));

  router.post("/application-accesses/:publicId/revoke", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "APPLICATION_ACCESS_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const corpo = (req.body ?? {}) as { expectedVersion?: number };
    if (!Number.isInteger(corpo.expectedVersion)) {
      erro(res, 422, "EXPECTED_VERSION_REQUIRED", "expectedVersion é obrigatório para revogar.");
      return;
    }
    const resultado = await deps.revokeApplicationAccessService.execute({
      applicationAccessPublicId: publicId,
      revokedByIdentityPublicId: atorAutenticado(req),
      expectedVersion: Number(corpo.expectedVersion)
    });
    res.status(200).json(resultado);
  }));

  /**
   * Correção administrativa de nomes da organização (v0.10.1).
   *
   * `POST .../names`, e não um `PUT`/`PATCH` no recurso inteiro, porque
   * o que esta rota aceita é estritamente isto: razão social e nome
   * fantasia. Um verbo de recurso inteiro convidaria a mandar `type`,
   * `status` ou `document_number` no mesmo corpo — e a única defesa
   * seria lembrar de ignorá-los. Aqui não há o que ignorar: eles não
   * têm campo.
   *
   * `expectedVersion` é obrigatório. Sem ele, duas pessoas editando a
   * mesma organização viram "a última salva vence", e a correção de uma
   * some sem aviso.
   */
  router.post("/organizations/:publicId/names", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "ORGANIZATION_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const corpo = (req.body ?? {}) as {
      legalName?: unknown;
      tradeName?: unknown;
      expectedVersion?: unknown;
    };
    if (!Number.isInteger(corpo.expectedVersion)) {
      erro(res, 422, "EXPECTED_VERSION_REQUIRED", "expectedVersion é obrigatório para editar.");
      return;
    }
    if (typeof corpo.legalName !== "string") {
      erro(res, 422, "ORGANIZATION_LEGAL_NAME_INVALID", "Informe a razão social.");
      return;
    }

    const resultado = await deps.renameOrganizationService.execute({
      organizationPublicId: publicId,
      legalName: corpo.legalName,
      // Três estados distintos, e a diferença importa: ausente = manter,
      // string vazia = limpar, texto = definir. Colapsar os dois
      // primeiros apagaria o nome fantasia de quem só corrigiu a razão
      // social.
      tradeName: corpo.tradeName === undefined ? undefined : String(corpo.tradeName ?? ""),
      expectedVersion: Number(corpo.expectedVersion),
      actorPublicId: atorAutenticado(req)
    });
    res.status(200).json(resultado);
  }));

  router.post("/memberships", envolver(async (req, res) => {
    const corpo = (req.body ?? {}) as {
      identityPublicId?: string;
      organizationPublicId?: string;
      profile?: string;
      scope?: string;
    };
    const resultado = await deps.createMembershipService.execute({
      identityPublicId: String(corpo.identityPublicId ?? ""),
      organizationPublicId: String(corpo.organizationPublicId ?? ""),
      profile: String(corpo.profile ?? ""),
      scope: String(corpo.scope ?? ""),
      actorPublicId: atorAutenticado(req)
    });
    res.status(201).json(resultado);
  }));

  router.post("/memberships/:publicId/end", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "MEMBERSHIP_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const corpo = (req.body ?? {}) as { reason?: string };
    const motivo = String(corpo.reason ?? "").trim();
    if (motivo.length === 0) {
      erro(res, 422, "MEMBERSHIP_END_REASON_REQUIRED", "Informe o motivo do encerramento.");
      return;
    }
    const resultado = await deps.endMembershipService.execute({
      membershipPublicId: publicId,
      reason: motivo,
      actorPublicId: atorAutenticado(req)
    });
    res.status(200).json(resultado);
  }));

  return router;
}
