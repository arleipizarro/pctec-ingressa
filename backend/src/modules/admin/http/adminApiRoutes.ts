import { Router, type Response, type NextFunction } from "express";
import type { RequestWithAuthorization } from "../../authorization/http/requireApplicationAccess.js";
import { ImportItemSnapshot } from "../../import/domain/ImportItemSnapshot.js";
import type { MariaDbAdminReadRepository } from "../infrastructure/persistence/MariaDbAdminReadRepository.js";
import type { GrantApplicationAccessService } from "../../application/application/GrantApplicationAccessService.js";
import type { RevokeApplicationAccessService } from "../../application/application/RevokeApplicationAccessService.js";
import type { CreateMembershipService } from "../../organization/application/CreateMembershipService.js";
import type { EndMembershipService } from "../../organization/application/EndMembershipService.js";
import type { ActivateFederatedIdentityService } from "../../helpdesk/application/ActivateFederatedIdentityService.js";
import type { BlockIdentityService } from "../../identity/application/BlockIdentityService.js";
import type { UnblockIdentityService } from "../../identity/application/UnblockIdentityService.js";
import type { RevokeAllSessionsService } from "../../security/application/RevokeAllSessionsService.js";
import type { RevokeInvitationService } from "../../invitation/application/RevokeInvitationService.js";
import type { RenameOrganizationService } from "../../organization/application/RenameOrganizationService.js";
import type { CreateOrganizationRelationshipService } from "../../organization/application/CreateOrganizationRelationshipService.js";
import type { ProvisionOrganizationService } from "../../organization/application/ProvisionOrganizationService.js";
import type { ProvisionOrganizationUserService } from "../application/ProvisionOrganizationUserService.js";
import type { CreateIdentityInvitationService } from "../../invitation/application/CreateIdentityInvitationService.js";

export interface AdminApiDeps {
  readonly readRepository: MariaDbAdminReadRepository;
  readonly grantApplicationAccessService: GrantApplicationAccessService;
  readonly revokeApplicationAccessService: RevokeApplicationAccessService;
  readonly createMembershipService: CreateMembershipService;
  readonly endMembershipService: EndMembershipService;
  readonly activateFederatedIdentityService: ActivateFederatedIdentityService;
  readonly blockIdentityService: BlockIdentityService;
  readonly unblockIdentityService: UnblockIdentityService;
  readonly revokeAllSessionsService: RevokeAllSessionsService;
  readonly revokeInvitationService: RevokeInvitationService;
  readonly renameOrganizationService: RenameOrganizationService;
  readonly createOrganizationRelationshipService: CreateOrganizationRelationshipService;
  readonly provisionOrganizationService: ProvisionOrganizationService;
  readonly provisionOrganizationUserService: ProvisionOrganizationUserService;
  /**
   * O MESMO serviço oficial usado pela tela de convites. O
   * provisionamento não tem caminho de convite próprio — se tivesse,
   * seriam duas implementações da mesma regra de elegibilidade.
   */
  readonly createIdentityInvitationService: CreateIdentityInvitationService;
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

  // ------------------------------------------------------------------
  // Ciclo de acesso de uma Identity
  // ------------------------------------------------------------------

  router.get("/identities/:publicId/sessions", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    res.status(200).json({ items: await deps.readRepository.listarSessoesAtivas(publicId) });
  }));

  router.get("/identities/:publicId/invitations", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    res.status(200).json({ items: await deps.readRepository.listarConvites(publicId) });
  }));

  /**
   * Encerra todas as sessões ativas. Idempotente: sem sessões, responde
   * 200 com `revoked: 0` — o estado final desejado é o mesmo.
   */
  router.post("/identities/:publicId/sessions/revoke-all", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const resultado = await deps.revokeAllSessionsService.execute({
      identityPublicId: publicId,
      actorPublicId: atorAutenticado(req),
      correlationId: req.correlationId
    });
    res.status(200).json(resultado);
  }));

  /**
   * Bloqueia a Identity e derruba as sessões na mesma transação.
   *
   * `expectedVersion` vem do corpo porque é a versão que a TELA exibia:
   * se alguém mudou a identidade no meio, o backend responde 409 em vez
   * de sobrescrever a decisão do outro. O ATOR, esse, nunca vem do
   * corpo — sai da sessão administrativa.
   */
  router.post("/identities/:publicId/block", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const expectedVersion = Number(corpo["expectedVersion"]);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      erro(res, 422, "IDENTITY_VERSION_INVALID", "expectedVersion é obrigatório.");
      return;
    }
    const reasonCode = typeof corpo["reasonCode"] === "string" ? (corpo["reasonCode"] as string) : undefined;

    const resultado = await deps.blockIdentityService.execute({
      identityPublicId: publicId,
      actorPublicId: atorAutenticado(req),
      expectedVersion,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      correlationId: req.correlationId
    });
    res.status(200).json(resultado);
  }));

  /**
   * Desbloqueio — transição inversa do bloqueio, e só isso: nenhuma
   * sessão, convite, membership ou acesso é recriado.
   */
  router.post("/identities/:publicId/unblock", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "IDENTITY_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const expectedVersion = Number(corpo["expectedVersion"]);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      erro(res, 422, "IDENTITY_VERSION_INVALID", "expectedVersion é obrigatório.");
      return;
    }

    const resultado = await deps.unblockIdentityService.execute({
      identityPublicId: publicId,
      actorPublicId: atorAutenticado(req),
      expectedVersion,
      correlationId: req.correlationId
    });
    res.status(200).json(resultado);
  }));

  router.post("/invitations/:publicId/revoke", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "INVITATION_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const resultado = await deps.revokeInvitationService.execute({
      invitationPublicId: publicId,
      actorPublicId: atorAutenticado(req),
      correlationId: req.correlationId
    });
    res.status(200).json(resultado);
  }));

  // ------------------------------------------------------------------
  // Organizações
  // ------------------------------------------------------------------

  /**
   * Correção de nomes. `expectedVersion` vem do corpo por ser a versão
   * que a TELA exibia — trava otimista real contra 409. O ator sai da
   * sessão administrativa, nunca do corpo.
   *
   * `tradeName` ausente significa "manter"; string vazia significa
   * "limpar". Mandar sempre apagaria o nome fantasia de quem só corrigiu
   * a razão social.
   */
  router.post("/organizations/:publicId/names", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "ORGANIZATION_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const legalName = typeof corpo["legalName"] === "string" ? (corpo["legalName"] as string) : "";
    const expectedVersion = Number(corpo["expectedVersion"]);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      erro(res, 422, "ORGANIZATION_VERSION_INVALID", "expectedVersion é obrigatório.");
      return;
    }

    const resultado = await deps.renameOrganizationService.execute({
      organizationPublicId: publicId,
      legalName,
      ...("tradeName" in corpo ? { tradeName: corpo["tradeName"] as string | null } : {}),
      actorPublicId: atorAutenticado(req),
      expectedVersion,
      correlationId: req.correlationId
    });
    res.status(200).json(resultado);
  }));

  /**
   * Associação inicial de uma COMPANY a um BUSINESS_GROUP.
   *
   * Só INSERT: uma COMPANY que já tem grupo é recusada pelo próprio
   * serviço (`OrganizationRelationshipChildAlreadyLinkedError`). Trocar
   * ou encerrar o vínculo não é possível nesta fatia — a tabela
   * `organization_relationships` não tem coluna de ciclo de vida, e a
   * única forma seria apagar a linha, perdendo o histórico. Ver PR.
   */
  router.post("/organizations/:publicId/parent", envolver(async (req, res) => {
    const publicId = publicIdDaRota(req, "publicId");
    if (publicId === undefined) {
      erro(res, 422, "ORGANIZATION_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const parent = typeof corpo["parentOrganizationPublicId"] === "string"
      ? (corpo["parentOrganizationPublicId"] as string)
      : "";
    if (!UUID.test(parent)) {
      erro(res, 422, "ORGANIZATION_PUBLIC_ID_INVALID", "parentOrganizationPublicId inválido.");
      return;
    }

    const resultado = await deps.createOrganizationRelationshipService.execute({
      parentOrganizationPublicId: parent,
      childOrganizationPublicId: publicId,
      actorPublicId: atorAutenticado(req),
      correlationId: req.correlationId
    });
    res.status(201).json(resultado);
  }));

  /**
   * Criação de organização — COMPANY ou BUSINESS_GROUP, com associação
   * inicial OPCIONAL a um grupo.
   *
   * Nenhum campo além de tipo, razão social e nome fantasia: o domínio
   * não exige mais nada para criar (`documentNumber` é opcional em
   * `Organization.create`). Pedir CNPJ aqui seria inventar obrigação que
   * o modelo não tem — e o documento tem regra de unicidade própria, que
   * merece a tela dela quando for a hora.
   *
   * Nenhuma referência externa é criada, e nada é inferido do Helpdesk
   * ou do Portal: esta organização nasce no Ingressa.
   */
  router.post("/organizations", envolver(async (req, res) => {
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const type = typeof corpo["type"] === "string" ? (corpo["type"] as string).trim() : "";
    const legalName = typeof corpo["legalName"] === "string" ? (corpo["legalName"] as string).trim() : "";
    if (legalName.length === 0) {
      erro(res, 422, "ORGANIZATION_LEGAL_NAME_REQUIRED", "Informe a razão social.");
      return;
    }
    const parent = typeof corpo["parentBusinessGroupPublicId"] === "string"
      ? (corpo["parentBusinessGroupPublicId"] as string).trim()
      : "";
    if (parent.length > 0 && !UUID.test(parent)) {
      erro(res, 422, "ORGANIZATION_PUBLIC_ID_INVALID", "parentBusinessGroupPublicId inválido.");
      return;
    }

    const resultado = await deps.provisionOrganizationService.execute({
      type,
      legalName,
      ...(typeof corpo["tradeName"] === "string" && (corpo["tradeName"] as string).trim().length > 0
        ? { tradeName: (corpo["tradeName"] as string).trim() }
        : {}),
      ...(parent.length > 0 ? { parentBusinessGroupPublicId: parent } : {}),
      actorPublicId: atorAutenticado(req),
      correlationId: req.correlationId
    });
    res.status(201).json(resultado);
  }));

  /**
   * Provisionamento de usuário DENTRO de uma organização.
   *
   * Duas etapas deliberadamente separadas:
   *
   * 1. `provisionOrganizationUserService` — Identity + ativação +
   *    membership + acessos, tudo numa transação. Falhou, nada foi
   *    criado.
   * 2. o convite, DEPOIS do commit, pelo serviço oficial.
   *
   * A separação não é descuido: o convite entrega um link, e entregar
   * dentro da transação mandaria um link que um rollback tornaria
   * inválido. Por isso a resposta distingue "usuário criado" de "convite
   * gerado" — são dois fatos, e o segundo pode falhar sem desfazer o
   * primeiro. Quando falha, o usuário está correto e completo, e o ADMIN
   * reemite pela ação "Criar convite" que já existe.
   */
  router.post("/organizations/:publicId/users", envolver(async (req, res) => {
    const organizationPublicId = publicIdDaRota(req, "publicId");
    if (organizationPublicId === undefined) {
      erro(res, 422, "ORGANIZATION_PUBLIC_ID_INVALID", "publicId inválido.");
      return;
    }
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const texto = (campo: string): string =>
      typeof corpo[campo] === "string" ? (corpo[campo] as string).trim() : "";

    const applicationCodes = Array.isArray(corpo["applicationCodes"])
      ? (corpo["applicationCodes"] as unknown[]).filter((c): c is string => typeof c === "string")
      : [];

    const ator = atorAutenticado(req);
    const provisionado = await deps.provisionOrganizationUserService.execute({
      organizationPublicId,
      fullName: texto("fullName"),
      email: texto("email"),
      membershipProfile: texto("membershipProfile"),
      membershipScope: texto("membershipScope"),
      applicationCodes,
      actorPublicId: ator,
      correlationId: req.correlationId
    });

    // `sendInvitation` ausente significa NÃO convidar — o pedido prevê
    // criar agora e convidar depois. Só um `true` explícito convida.
    const convidar = corpo["sendInvitation"] === true;
    let invitation: Record<string, unknown> | null = null;
    if (convidar) {
      try {
        const emissao = await deps.createIdentityInvitationService.execute({
          identityPublicIds: [provisionado.identityPublicId],
          invitedByPublicId: ator,
          correlationId: req.correlationId
        });
        const item = emissao.results[0];
        invitation = {
          outcome: item?.outcome ?? "FAILED",
          reasonCode: item?.reasonCode ?? null,
          deliveryMode: emissao.deliveryMode,
          expiresAt: item?.expiresAt ?? null,
          delivered: item?.delivered ?? false,
          // Link do modo manual: volta UMA vez, nesta resposta. Não é
          // persistido nem reexibível.
          manualLink: item?.manualLink ?? null
        };
      } catch {
        // O usuário JÁ está criado e correto. Derrubar a resposta aqui
        // faria a tela reportar falha total de algo que funcionou pela
        // metade certa — e o ADMIN tentaria criar tudo de novo, batendo
        // em e-mail duplicado.
        invitation = {
          outcome: "FAILED",
          reasonCode: "INVITATION_DELIVERY_FAILED",
          deliveryMode: null,
          expiresAt: null,
          delivered: false,
          manualLink: null
        };
      }
    }

    res.status(201).json({ ...provisionado, invitationRequested: convidar, invitation });
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
