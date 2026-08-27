/**
 * Cliente HTTP da API administrativa.
 *
 * `credentials: "include"` e NENHUM token no browser: a sessão é o
 * cookie HttpOnly que o backend já emite. Guardar token em
 * localStorage seria expor a sessão a qualquer XSS — e o backend não
 * precisa disso.
 */
export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Mensagens por status — o usuário lê o que fazer, não o erro interno. */
const MENSAGEM_POR_STATUS: Readonly<Record<number, string>> = {
  400: "Requisição inválida.",
  401: "Sua sessão expirou. Entre novamente.",
  403: "Você não tem permissão para esta operação.",
  404: "Registro não encontrado.",
  409: "O registro mudou desde que a tela carregou. Recarregue e tente de novo.",
  422: "Dados inválidos. Revise os campos.",
  500: "Erro interno. Tente novamente em instantes."
};

async function requisitar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(`/api/v1${caminho}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });

  if (!resposta.ok) {
    let code = "UNKNOWN";
    try {
      const corpo = (await resposta.json()) as { error?: { code?: string } };
      code = corpo.error?.code ?? code;
    } catch {
      // Resposta sem corpo JSON — mantém o código genérico.
    }
    throw new ApiError(
      resposta.status,
      code,
      MENSAGEM_POR_STATUS[resposta.status] ?? "Não foi possível concluir a operação."
    );
  }

  if (resposta.status === 204) {
    return undefined as T;
  }
  return (await resposta.json()) as T;
}

export const api = {
  whoami: () =>
    requisitar<{ identity: { publicId: string; fullName: string | null }; access: { profile: string } }>(
      "/admin/whoami"
    ),
  /**
   * Painel "Meus aplicativos" — e, de quebra, a sessão.
   *
   * Substituiu `whoami` como fonte da sessão da UI: `whoami` responde
   * 403 para quem não é ADMIN, o que fazia todo usuário federado cair no
   * login como se não estivesse autenticado. `/apps` responde 200 para
   * qualquer sessão válida e já traz os cards que a pessoa pode ver.
   */
  apps: () => requisitar<PainelDeAplicativos>("/apps"),
  /**
   * Organizações com membership ACTIVE.
   *
   * Hoje o único endpoint browser-facing que devolve isso é
   * `/portal/context`, que está atrás de
   * `ApplicationAccess(PCTEC_PORTAL, USER)`. Quem não tem acesso ao
   * Portal recebe 403 — e a tela trata esse caso explicitamente, em vez
   * de fingir que a pessoa não tem vínculo nenhum. Ver nota no PR: o
   * vínculo empresarial e o acesso a produto são eixos independentes
   * (ADR-031 §6), e a rota certa para o launcher ainda não existe.
   */
  organizacoes: () => requisitar<{ organizations: readonly OrganizacaoDoUsuario[] }>("/portal/context"),
  /** Convites (ADMIN). O link do modo manual volta UMA vez — não é reexibível. */
  convidar: (identityPublicIds: readonly string[]) =>
    requisitar<ResultadoDeConvites>("/admin/invitations", {
      method: "POST",
      body: JSON.stringify({ identityPublicIds })
    }),
  /** Convite (público) — o token vai no CORPO, nunca na URL. */
  previewConvite: (token: string) =>
    requisitar<{ fullName: string; expiresAt: string }>("/invitations/preview", {
      method: "POST",
      body: JSON.stringify({ token })
    }),
  definirSenhaPorConvite: (token: string, password: string, passwordConfirmation: string) =>
    requisitar<{ identity: { publicId: string }; loginEnabled: boolean }>("/invitations/redeem", {
      method: "POST",
      body: JSON.stringify({ token, password, passwordConfirmation })
    }),
  login: (email: string, password: string) =>
    requisitar<unknown>("/sessions", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => requisitar<unknown>("/sessions/current", { method: "DELETE" }),
  summary: () => requisitar<Resumo>("/admin/summary"),
  applications: () => requisitar<{ items: readonly Aplicacao[] }>("/admin/applications"),
  identities: (params: URLSearchParams) => requisitar<Pagina<Identidade>>(`/admin/identities?${params.toString()}`),
  identity: (publicId: string) => requisitar<IdentidadeDetalhe>(`/admin/identities/${publicId}`),
  organizations: (params: URLSearchParams) => requisitar<Pagina<Organizacao>>(`/admin/organizations?${params.toString()}`),
  organization: (publicId: string) => requisitar<OrganizacaoDetalhe>(`/admin/organizations/${publicId}`),
  /**
   * Correção de nomes.
   *
   * `tradeName` só entra no corpo quando foi informado: ausente
   * significa "manter", string vazia significa "limpar". Mandar sempre
   * apagaria o nome fantasia de quem só corrigiu a razão social.
   */
  renameOrganization: (
    publicId: string,
    payload: { legalName: string; tradeName?: string | undefined; expectedVersion: number }
  ) =>
    requisitar<RenomeacaoDeOrganizacao>(`/admin/organizations/${publicId}/names`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  /**
   * Criação de organização, com associação inicial OPCIONAL.
   *
   * `parentBusinessGroupPublicId` só entra no corpo quando escolhido — e
   * só faz sentido para COMPANY. O servidor recusa a combinação
   * BUSINESS_GROUP + grupo pai antes de escrever qualquer coisa.
   */
  createOrganization: (payload: {
    type: string;
    legalName: string;
    tradeName?: string | undefined;
    parentBusinessGroupPublicId?: string | undefined;
  }) =>
    requisitar<OrganizacaoCriada>("/admin/organizations", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  /**
   * Provisionamento de usuário dentro de uma organização.
   *
   * O perfil de acesso NÃO é enviado: o servidor concede sempre `USER`.
   * Conceder ADMIN continua sendo ação separada, na tela da Identity.
   *
   * `sendInvitation` ausente ou `false` cria o usuário sem convite — o
   * ADMIN pode emitir depois pela tela de convites.
   */
  createOrganizationUser: (
    organizationPublicId: string,
    payload: {
      fullName: string;
      email: string;
      membershipProfile: string;
      membershipScope: string;
      applicationCodes: readonly string[];
      sendInvitation: boolean;
    }
  ) =>
    requisitar<UsuarioProvisionado>(`/admin/organizations/${organizationPublicId}/users`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  /**
   * Vincula uma COMPANY ao Portal — `PCTEC_PORTAL`/`clientes`.
   *
   * O corpo carrega SÓ `legacyId`. `systemCode` e `entityType` são
   * fixados no servidor e não têm campo: mandá-los daqui transformaria
   * a tela num CLI genérico de referências externas, que é exatamente o
   * poder que ela não deve ter.
   *
   * Responde 201 quando cria e 200 quando o vínculo idêntico já
   * existia — os dois caem no mesmo `then`, e `alreadyLinked` distingue.
   */
  linkPortalReference: (publicId: string, legacyId: number) =>
    requisitar<ReferenciaPortalVinculada>(`/admin/organizations/${publicId}/portal-reference`, {
      method: "POST",
      body: JSON.stringify({ legacyId })
    }),
  /** Associação inicial: só para COMPANY ainda sem grupo. */
  associateParent: (publicId: string, parentOrganizationPublicId: string) =>
    requisitar<unknown>(`/admin/organizations/${publicId}/parent`, {
      method: "POST",
      body: JSON.stringify({ parentOrganizationPublicId })
    }),
  /**
   * Trilha de auditoria. O payload já chega REDIGIDO pelo servidor — a
   * UI nunca decide o que esconder.
   */
  auditEvents: (params: URLSearchParams) =>
    requisitar<Pagina<EventoDeAuditoria>>(`/admin/audit-events?${params.toString()}`),
  /** Tipos presentes na base, para o filtro não inventar opções. */
  auditEventTypes: () => requisitar<{ items: readonly string[] }>("/admin/audit-events/event-types"),
  importBatches: (params: URLSearchParams) => requisitar<Pagina<Lote>>(`/admin/import-batches?${params.toString()}`),
  importBatchItems: (publicId: string, params: URLSearchParams) =>
    requisitar<Pagina<ItemDeLote>>(`/admin/import-batches/${publicId}/items?${params.toString()}`),
  activateFederated: (publicId: string) =>
    requisitar<unknown>(`/admin/identities/${publicId}/activate-federated`, { method: "POST", body: "{}" }),
  grantAccess: (publicId: string, applicationCode: string, accessProfile: string) =>
    requisitar<unknown>(`/admin/identities/${publicId}/application-accesses`, {
      method: "POST",
      body: JSON.stringify({ applicationCode, accessProfile })
    }),
  revokeAccess: (publicId: string, expectedVersion: number) =>
    requisitar<unknown>(`/admin/application-accesses/${publicId}/revoke`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion })
    }),
  // --- Ciclo de acesso de uma Identity (v1) -------------------------
  sessions: (publicId: string) => requisitar<{ items: readonly SessaoAtiva[] }>(`/admin/identities/${publicId}/sessions`),
  invitations: (publicId: string) => requisitar<{ items: readonly ConviteDaIdentidade[] }>(`/admin/identities/${publicId}/invitations`),
  revokeAllSessions: (publicId: string) =>
    requisitar<{ revoked: number }>(`/admin/identities/${publicId}/sessions/revoke-all`, { method: "POST", body: "{}" }),
  /** `expectedVersion` é a versão EXIBIDA — trava otimista contra tela velha. */
  blockIdentity: (publicId: string, expectedVersion: number) =>
    requisitar<{ status: string; sessionsRevoked: number }>(`/admin/identities/${publicId}/block`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion })
    }),
  /** Transição inversa do bloqueio — não recria sessão, convite ou acesso. */
  unblockIdentity: (publicId: string, expectedVersion: number) =>
    requisitar<{ status: string; loginEnabled: boolean }>(`/admin/identities/${publicId}/unblock`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion })
    }),
  revokeInvitation: (invitationPublicId: string) =>
    requisitar<unknown>(`/admin/invitations/${invitationPublicId}/revoke`, { method: "POST", body: "{}" }),

  createMembership: (payload: {
    identityPublicId: string;
    organizationPublicId: string;
    profile: string;
    scope: string;
  }) => requisitar<unknown>("/admin/memberships", { method: "POST", body: JSON.stringify(payload) }),
  endMembership: (publicId: string, reason: string) =>
    requisitar<unknown>(`/admin/memberships/${publicId}/end`, { method: "POST", body: JSON.stringify({ reason }) }),

  // --- Assistente de importação do Helpdesk (v0.10.x) ---------------
  //
  // O cliente envia SELEÇÃO. Nunca ação, escopo de membership, perfil
  // de acesso ou publicId de destino calculado aqui: o plano é
  // recalculado no backend a cada chamada, e o que este arquivo mandar
  // além da seleção é descartado na fronteira.
  helpdeskCompanies: (params: URLSearchParams) =>
    requisitar<PaginaCatalogo<EmpresaDeOrigem>>(`/admin/helpdesk-import/companies?${params.toString()}`),
  helpdeskCompanyUsers: (sourceClientId: number) =>
    requisitar<UsuariosDeOrigem>(`/admin/helpdesk-import/companies/${sourceClientId}/users`),
  helpdeskPreview: (selecao: SelecaoDeImportacao) =>
    requisitar<PreviaDaImportacao>("/admin/helpdesk-import/preview", {
      method: "POST",
      body: JSON.stringify(selecao)
    }),
  helpdeskDryRun: (selecao: SelecaoDeImportacao) =>
    requisitar<ResultadoDaImportacao>("/admin/helpdesk-import/dry-run", {
      method: "POST",
      body: JSON.stringify(selecao)
    }),
  helpdeskApply: (selecao: SelecaoDeImportacao, dryRunBatchPublicId: string, confirmation: string) =>
    requisitar<ResultadoDaImportacao>("/admin/helpdesk-import/apply", {
      method: "POST",
      body: JSON.stringify({ ...selecao, dryRunBatchPublicId, confirmation })
    })
};

export interface SelecaoDeImportacao {
  readonly sourceClientId: number;
  readonly selectedSourceUserIds: readonly number[];
  readonly targetOrganizationPublicId?: string | undefined;
  readonly parentBusinessGroupPublicId?: string | undefined;
}

export interface PaginaCatalogo<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface OrganizacaoVinculada {
  readonly organizationPublicId: string;
  readonly legalName: string;
  readonly type: string;
  readonly status: string;
}

export interface EmpresaDeOrigem {
  readonly sourceClientId: number;
  readonly name: string;
  readonly active: boolean;
  readonly linkedOrganization: OrganizacaoVinculada | null;
}

export interface UsuarioDeOrigem {
  readonly sourceUserId: number;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly sourceClientId: number | null;
  readonly eligible: boolean;
  readonly ineligibilityReasons: readonly string[];
  readonly linkedIdentity: { readonly identityPublicId: string; readonly fullName: string; readonly status: string } | null;
  readonly suggestedSelected: boolean;
}

export interface UsuariosDeOrigem {
  readonly sourceClientId: number;
  readonly items: readonly UsuarioDeOrigem[];
  readonly total: number;
  readonly eligibleTotal: number;
  readonly alreadyImportedTotal: number;
}

/** Snapshot já REDIGIDO pelo backend — a UI nunca decide o que esconder. */
export interface SnapshotRedigido {
  readonly fields: Record<string, unknown>;
  readonly redactedFields: readonly string[];
}

export interface ItemProposto {
  readonly entityKind: string;
  readonly action: string;
  readonly reasonCode: string;
  readonly before: SnapshotRedigido | null;
  readonly after: SnapshotRedigido | null;
}

export interface UsuarioProposto {
  readonly sourceLegacyId: number;
  readonly name: string;
  readonly email: string;
  readonly linkKind: string;
  readonly writes: boolean;
  readonly existingIdentityPublicId: string | null;
  readonly items: readonly ItemProposto[];
}

export interface PreviaDaImportacao {
  readonly mappingRulesVersion: string;
  readonly applyConfirmationWord: string;
  readonly source: { readonly sourceClientId: number; readonly name: string; readonly active: boolean };
  readonly organization: {
    readonly resolution: string;
    readonly publicId: string | null;
    readonly legalName: string;
    readonly type: string;
    readonly status: string | null;
    readonly assertionConflict: string | null;
    readonly blockingReasonCode: string | null;
    readonly actions: readonly ItemProposto[];
  };
  readonly businessGroup: {
    readonly publicId: string;
    readonly legalName: string | null;
    readonly eligible: boolean;
    readonly ineligibleReason: string | null;
    readonly existingRelationshipPublicId: string | null;
  } | null;
  readonly countsByAction: Record<string, number>;
  readonly writes: boolean;
  readonly users: readonly UsuarioProposto[];
}

export interface ResultadoUsuario {
  readonly sourceLegacyId: number;
  readonly sourceName: string;
  readonly sourceEmail: string;
  readonly linkKind: string;
  readonly actionsByEntityKind: Record<string, string>;
  readonly reasonCodes: readonly string[];
  readonly writtenTargets: Record<string, string>;
  readonly identityStatus: string | null;
  readonly activatedNow: boolean;
}

export interface ResultadoDaImportacao {
  readonly batchPublicId: string;
  readonly mode: string;
  readonly status: string;
  readonly sourceClientId: number;
  readonly sourceClientName: string;
  readonly organizationResolution: string;
  readonly organizationPublicId: string | null;
  readonly organizationLegalName: string | null;
  readonly parentBusinessGroupPublicId: string | null;
  readonly scopeFingerprint: string;
  readonly mappingRulesVersion: string;
  readonly countsByAction: Record<string, number>;
  readonly organizationActions: Record<string, string>;
  readonly organizationTargets: Record<string, string>;
  readonly blockingReasonCode: string | null;
  readonly users: readonly ResultadoUsuario[];
  readonly recordedItems: number;
  readonly resumedUsers: readonly number[];
}

export interface Pagina<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface Identidade {
  readonly public_id: string;
  readonly full_name: string;
  readonly email: string;
  readonly status: string;
  readonly type: string;
  readonly login_enabled: number;
}

export interface ReferenciaExterna {
  readonly public_id: string;
  readonly system_code: string;
  readonly entity_type: string;
  readonly legacy_id: number;
  readonly match_method?: string;
  readonly status: string;
}

export interface MembershipView {
  readonly public_id: string;
  readonly organization_public_id: string;
  readonly legal_name: string;
  readonly trade_name: string | null;
  readonly profile: string;
  readonly scope: string;
  readonly status: string;
}

export interface AcessoView {
  readonly public_id: string;
  readonly application_code: string;
  readonly access_profile: string;
  readonly status: string;
  readonly version: number;
}

/** Nunca traz token nem hash — a projeção do servidor não os seleciona. */
export interface SessaoAtiva {
  readonly public_id: string;
  readonly status: string;
  readonly created_at: string;
  readonly last_seen_at: string | null;
  readonly expires_at: string;
}

export interface ConviteDaIdentidade {
  readonly public_id: string;
  readonly status: string;
  readonly delivery_mode: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly revoked_at: string | null;
  /** `EXPIRED` não é status persistido — vem calculado pelo servidor. */
  readonly expired: number;
}

export interface IdentidadeDetalhe extends Identidade {
  /** Trava otimista: reenviada no bloqueio e comparada no servidor. */
  readonly version: number;
  readonly federated: boolean;
  readonly externalReferences: readonly ReferenciaExterna[];
  readonly memberships: readonly MembershipView[];
  readonly applicationAccesses: readonly AcessoView[];
}

export interface Organizacao {
  readonly public_id: string;
  readonly type: string;
  readonly legal_name: string;
  readonly trade_name: string | null;
  readonly status: string;
}

export interface RenomeacaoDeOrganizacao {
  readonly publicId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly version: number;
  readonly changed: boolean;
  readonly changedFields: readonly string[];
}

export interface OrganizacaoCriada {
  readonly publicId: string;
  readonly type: string;
  readonly status: string;
  readonly version: number;
  /** `null` quando nenhuma associação inicial foi pedida. */
  readonly relationshipPublicId: string | null;
}

/**
 * Resultado do provisionamento.
 *
 * `invitation` é um fato SEPARADO de "usuário criado": pode ser `null`
 * (não foi pedido), `CREATED`, `SKIPPED` (inelegível) ou `FAILED` (a
 * emissão quebrou). Em nenhum desses casos o usuário deixa de existir —
 * por isso a tela mostra as duas coisas em separado.
 */
export interface ConviteDoProvisionamento {
  readonly outcome: "CREATED" | "SKIPPED" | "FAILED";
  readonly reasonCode: string | null;
  readonly deliveryMode: string | null;
  readonly expiresAt: string | null;
  readonly delivered: boolean;
  /** Modo manual: volta UMA vez. Nunca é persistido nem reexibível. */
  readonly manualLink: string | null;
}

export interface UsuarioProvisionado {
  readonly identityPublicId: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: string;
  readonly loginEnabled: boolean;
  readonly membership: {
    readonly publicId: string;
    readonly organizationPublicId: string;
    readonly profile: string;
    readonly scope: string;
    readonly status: string;
  };
  readonly applicationAccesses: readonly { readonly applicationCode: string; readonly accessProfile: string }[];
  readonly invitationRequested: boolean;
  readonly invitation: ConviteDoProvisionamento | null;
}

/** A referência `PCTEC_PORTAL`/`clientes` ACTIVE de uma empresa. */
export interface ReferenciaDoPortal {
  /** `public_id` da própria referência — identificador técnico. */
  readonly publicId: string;
  /**
   * `clientes.id` do Portal legado. Só existe em resposta administrativa:
   * é o dado que o ADMIN confere para saber se vinculou a empresa certa.
   */
  readonly legacyId: number;
  readonly status: string;
}

/** Empresa do grupo — identificada só por publicId e nomes organizacionais. */
export interface EmpresaSemReferenciaDoPortal {
  readonly publicId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
}

export interface CoberturaDeGrupoNoPortal {
  readonly totalActiveCompanies: number;
  readonly linkedCompanies: number;
  readonly missingCompaniesCount: number;
  readonly missingCompanies: readonly EmpresaSemReferenciaDoPortal[];
  /** `true` quando a lista acima é um recorte de `missingCompaniesCount`. */
  readonly missingCompaniesTruncated: boolean;
  /**
   * Empresas com MAIS DE UMA referência ACTIVE — nem vinculadas nem
   * faltando. Vincular de novo pioraria o cadastro; o que falta é
   * decidir qual referência vale.
   */
  readonly ambiguousCompaniesCount: number;
  readonly ambiguousCompanies: readonly EmpresaSemReferenciaDoPortal[];
}

/**
 * Estado da integração com o Portal, como o servidor o calcula.
 *
 * `covered` é a MESMA leitura que o provisionamento usa para recusar —
 * a tela não recalcula nada a partir de `externalReferences`, porque uma
 * segunda definição de "coberto" divergiria da primeira e passaria a
 * prometer o que o servidor nega.
 */
export interface IntegracaoComOPortal {
  readonly organizationPublicId: string;
  readonly organizationType: string;
  readonly organizationStatus: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly covered: boolean;
  /**
   * Mais de uma referência ACTIVE — na própria empresa, ou em alguma
   * empresa do grupo.
   *
   * Estado inconsistente que o CLI genérico ainda alcança. Quando
   * `true`, `reference` é `null`: o servidor não escolhe uma, e a tela
   * também não pode.
   */
  readonly ambiguous: boolean;
  /** Quantas referências ACTIVE a própria organização tem. Sempre 0 em grupo. */
  readonly activeReferenceCount: number;
  /** Só em COMPANY, e só quando há EXATAMENTE uma. Um BUSINESS_GROUP nunca tem referência própria. */
  readonly reference: ReferenciaDoPortal | null;
  /** Todas as referências ACTIVE quando há mais de uma — listadas, nunca eleitas. */
  readonly ambiguousReferences: readonly ReferenciaDoPortal[];
  /** Só em BUSINESS_GROUP. */
  readonly group: CoberturaDeGrupoNoPortal | null;
}

export interface ReferenciaPortalVinculada {
  readonly publicId: string;
  readonly organizationPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: number;
  readonly status: string;
  /** `true` quando o vínculo idêntico já existia e nada foi criado. */
  readonly alreadyLinked: boolean;
}

export interface OrganizacaoDetalhe extends Organizacao {
  /** Trava otimista: reenviada no salvamento e comparada no servidor. */
  readonly version: number;
  readonly parents: readonly Organizacao[];
  readonly children: readonly Organizacao[];
  readonly externalReferences: readonly ReferenciaExterna[];
  readonly members: readonly { public_id: string; full_name: string; profile: string; scope: string; status: string }[];
  readonly applications: readonly { application_code: string; access_profile: string; total: number }[];
  /**
   * Opcional de propósito: uma resposta anterior a esta fatia não traz o
   * campo, e a tela precisa continuar abrindo. Ausente é tratado como
   * "cobertura desconhecida" — nunca como "não vinculada", que seria
   * inventar um estado a partir de silêncio.
   */
  readonly portal?: IntegracaoComOPortal | null;
}

export interface Lote {
  readonly public_id: string;
  readonly source_system: string;
  readonly mode: string;
  readonly status: string;
  readonly mapping_rules_version: string;
  readonly started_at: string;
  readonly total_items: number;
}

export interface ItemDeLote {
  readonly public_id: string;
  readonly entity_kind: string;
  readonly source_entity_type: string;
  readonly source_legacy_id: number;
  readonly action: string;
  readonly reason_code: string | null;
  readonly target_public_id: string | null;
  readonly after_snapshot: { fields: Record<string, unknown>; redactedFields: readonly string[] } | null;
}

/**
 * Evento de auditoria, como a tela o recebe.
 *
 * `payload` é sempre o objeto redigido: `fields` com os valores que
 * passaram na política e `redactedFields` com os NOMES do que foi
 * escondido — quem audita vê que havia ali um campo sensível, sem
 * receber o valor. Token, hash, cookie, senha, credencial e id interno
 * não têm caminho até aqui.
 */
export interface EventoDeAuditoria {
  readonly event_public_id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly aggregate_public_id: string;
  readonly actor_public_id: string;
  /** `null` para marcadores reservados (SYSTEM, BOOTSTRAP). */
  readonly actor_full_name: string | null;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly occurred_at: string;
  readonly persisted_at: string;
  readonly payload: SnapshotRedigido;
}

export interface Aplicacao {
  readonly public_id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

export interface Resumo {
  readonly identitiesByStatus: readonly { status: string; total: number }[];
  readonly organizationsByTypeStatus: readonly { type: string; status: string; total: number }[];
  readonly grantedAccessesByApplication: readonly { applicationCode: string; accessProfile: string; total: number }[];
  readonly activeMemberships: number;
  readonly latestImportBatches: readonly Lote[];
  readonly importAlerts: readonly { action: string; total: number }[];
}

export interface AplicativoCard {
  readonly code: string;
  readonly name: string;
  readonly profile: string;
  /** `null` = há acesso, mas o destino não está configurado neste ambiente. */
  readonly launchUrl: string | null;
}

export interface OrganizacaoDoUsuario {
  readonly publicId: string;
  readonly type: string;
  readonly legalName: string;
  readonly tradeName: string | null;
}

export interface PainelDeAplicativos {
  readonly identity: { readonly publicId: string; readonly fullName: string };
  readonly applications: readonly AplicativoCard[];
}

export interface ConviteEmitido {
  readonly identityPublicId: string;
  readonly fullName: string;
  readonly outcome: "CREATED" | "SKIPPED";
  readonly reasonCode: string | null;
  readonly invitationPublicId: string | null;
  readonly expiresAt: string | null;
  readonly deliveryMode: string | null;
  readonly delivered: boolean;
  readonly manualLink: string | null;
}

export interface ResultadoDeConvites {
  readonly deliveryMode: string;
  readonly results: readonly ConviteEmitido[];
}
