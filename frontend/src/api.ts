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

export interface IdentidadeDetalhe extends Identidade {
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

export interface OrganizacaoDetalhe extends Organizacao {
  readonly parents: readonly Organizacao[];
  readonly children: readonly Organizacao[];
  readonly externalReferences: readonly ReferenciaExterna[];
  readonly members: readonly { public_id: string; full_name: string; profile: string; scope: string; status: string }[];
  readonly applications: readonly { application_code: string; access_profile: string; total: number }[];
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
