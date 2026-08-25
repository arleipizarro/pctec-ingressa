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
  whoami: () => requisitar<{ identity: { publicId: string }; access: { profile: string } }>("/admin/whoami"),
  login: (email: string, password: string) =>
    requisitar<unknown>("/sessions", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => requisitar<unknown>("/sessions/current", { method: "DELETE" }),
  summary: () => requisitar<Resumo>("/admin/summary"),
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
    requisitar<unknown>(`/admin/memberships/${publicId}/end`, { method: "POST", body: JSON.stringify({ reason }) })
};

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

export interface Resumo {
  readonly identitiesByStatus: readonly { status: string; total: number }[];
  readonly organizationsByTypeStatus: readonly { type: string; status: string; total: number }[];
  readonly grantedAccessesByApplication: readonly { applicationCode: string; accessProfile: string; total: number }[];
  readonly activeMemberships: number;
  readonly latestImportBatches: readonly Lote[];
  readonly importAlerts: readonly { action: string; total: number }[];
}
