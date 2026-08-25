/**
 * Fixtures da UI — TODAS sintéticas.
 *
 * Nenhum nome, e-mail ou empresa real entra aqui. Domínio
 * `@example.invalid` é reservado por RFC e não entrega mensagem a
 * ninguém; o teste-guarda `semPiiNasFixtures.test.ts` falha se alguém
 * colar um endereço real numa fixture.
 */
import type {
  EmpresaDeOrigem,
  Identidade,
  IdentidadeDetalhe,
  ItemDeLote,
  ItemProposto,
  Lote,
  Organizacao,
  OrganizacaoDetalhe,
  Pagina,
  PaginaCatalogo,
  PreviaDaImportacao,
  Resumo,
  ResultadoDaImportacao,
  ResultadoUsuario,
  UsuarioDeOrigem,
  UsuarioProposto,
  UsuariosDeOrigem
} from "../api.js";

export const ADMIN_PUBLIC_ID = "11111111-1111-4111-8111-111111111111";
export const IDENTIDADE_PUBLIC_ID = "22222222-2222-4222-8222-222222222222";
export const ORG_PUBLIC_ID = "33333333-3333-4333-8333-333333333333";
export const ACESSO_PUBLIC_ID = "44444444-4444-4444-8444-444444444444";
export const MEMBERSHIP_PUBLIC_ID = "55555555-5555-4555-8555-555555555555";
export const LOTE_PUBLIC_ID = "66666666-6666-4666-8666-666666666666";

export const RESUMO: Resumo = {
  identitiesByStatus: [
    { status: "ACTIVE", total: 3 },
    { status: "PENDING", total: 6 }
  ],
  organizationsByTypeStatus: [
    { type: "BUSINESS_GROUP", status: "ACTIVE", total: 1 },
    { type: "COMPANY", status: "ACTIVE", total: 5 }
  ],
  grantedAccessesByApplication: [{ applicationCode: "APP_SINTETICA", accessProfile: "USER", total: 2 }],
  activeMemberships: 3,
  latestImportBatches: [
    {
      public_id: LOTE_PUBLIC_ID,
      source_system: "SISTEMA_SINTETICO",
      mode: "DRY_RUN",
      status: "COMPLETED",
      mapping_rules_version: "regras-v2",
      started_at: "2026-08-25T10:00:00.000Z",
      total_items: 8
    }
  ],
  importAlerts: [{ action: "CONFLICT", total: 1 }]
};

export const IDENTIDADE: Identidade = {
  public_id: IDENTIDADE_PUBLIC_ID,
  full_name: "Piloto Um",
  email: "piloto.um@example.invalid",
  status: "PENDING",
  type: "HUMAN",
  login_enabled: 0
};

export const PAGINA_IDENTIDADES: Pagina<Identidade> = { items: [IDENTIDADE], total: 1, limit: 25, offset: 0 };

export const IDENTIDADE_DETALHE: IdentidadeDetalhe = {
  ...IDENTIDADE,
  federated: true,
  externalReferences: [
    {
      public_id: "77777777-7777-4777-8777-777777777777",
      system_code: "SISTEMA_SINTETICO",
      entity_type: "users",
      legacy_id: 999935,
      match_method: "CREATED_FROM_SOURCE",
      status: "ACTIVE"
    }
  ],
  memberships: [
    {
      public_id: MEMBERSHIP_PUBLIC_ID,
      organization_public_id: ORG_PUBLIC_ID,
      legal_name: "EMPRESA SINTETICA LTDA",
      trade_name: "SINTETICA",
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      status: "ACTIVE"
    }
  ],
  applicationAccesses: [
    {
      public_id: ACESSO_PUBLIC_ID,
      application_code: "APP_SINTETICA",
      access_profile: "USER",
      status: "GRANTED",
      version: 1
    }
  ]
};

export const ORGANIZACAO: Organizacao = {
  public_id: ORG_PUBLIC_ID,
  type: "COMPANY",
  legal_name: "EMPRESA SINTETICA LTDA",
  trade_name: "SINTETICA",
  status: "ACTIVE"
};

export const PAGINA_ORGANIZACOES: Pagina<Organizacao> = { items: [ORGANIZACAO], total: 1, limit: 25, offset: 0 };

export const ORGANIZACAO_DETALHE: OrganizacaoDetalhe = {
  ...ORGANIZACAO,
  version: 3,
  parents: [{ ...ORGANIZACAO, public_id: "88888888-8888-4888-8888-888888888888", type: "BUSINESS_GROUP", legal_name: "GRUPO SINTETICO", trade_name: "GRUPO" }],
  children: [],
  externalReferences: [],
  members: [{ public_id: MEMBERSHIP_PUBLIC_ID, full_name: "Piloto Um", profile: "CUSTOMER", scope: "ORGANIZATION_ONLY", status: "ACTIVE" }],
  applications: [{ application_code: "APP_SINTETICA", access_profile: "USER", total: 1 }]
};

export const GRUPO: Organizacao = {
  public_id: "88888888-8888-4888-8888-888888888888",
  type: "BUSINESS_GROUP",
  legal_name: "GRUPO SINTETICO",
  trade_name: "GRUPO",
  status: "ACTIVE"
};

export const PAGINA_ORGANIZACOES_COM_GRUPO: Pagina<Organizacao> = {
  items: [ORGANIZACAO, GRUPO],
  total: 2,
  limit: 25,
  offset: 0
};

export const APLICACOES = {
  items: [
    { public_id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "APP_SINTETICA", name: "Aplicação Sintética", status: "ACTIVE" },
    { public_id: "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "APP_DESATIVADA", name: "Aplicação Desativada", status: "INACTIVE" }
  ]
};

export const PAGINA_LOTES: Pagina<Lote> = { items: RESUMO.latestImportBatches as Lote[], total: 1, limit: 25, offset: 0 };

export const ITEM_DE_LOTE: ItemDeLote = {
  public_id: "99999999-9999-4999-8999-999999999999",
  entity_kind: "IDENTITY",
  source_entity_type: "users",
  source_legacy_id: 999935,
  action: "CREATE",
  reason_code: "CREATED_FROM_SOURCE",
  target_public_id: null,
  after_snapshot: {
    fields: { full_name: "Piloto Um", bcrypt_hash: "[REDIGIDO]" },
    redactedFields: ["bcrypt_hash"]
  }
};

export const PAGINA_ITENS: Pagina<ItemDeLote> = { items: [ITEM_DE_LOTE], total: 1, limit: 25, offset: 0 };

// ---------------------------------------------------------------------
// Assistente de importação do Helpdesk (v0.10.x)
//
// Ids de origem na faixa 9999xx e domínio `@example.invalid`: nenhum
// identificador operacional real do Helpdesk entra aqui — o guarda
// `semPiiNasFixtures.test.ts` reprova se entrar.
// ---------------------------------------------------------------------

export const CLIENTE_DE_ORIGEM = 999901;
export const LOTE_DRY_RUN_PUBLIC_ID = "abcdabcd-1111-4111-8111-abcdabcdabcd";
export const LOTE_APPLY_PUBLIC_ID = "abcdabcd-2222-4222-8222-abcdabcdabcd";
export const NOVA_ORG_PUBLIC_ID = "abcdabcd-3333-4333-8333-abcdabcdabcd";
export const NOVA_IDENTIDADE_PUBLIC_ID = "abcdabcd-4444-4444-8444-abcdabcdabcd";
export const NOVA_MEMBERSHIP_PUBLIC_ID = "abcdabcd-5555-4555-8555-abcdabcdabcd";
export const NOVO_ACESSO_PUBLIC_ID = "abcdabcd-6666-4666-8666-abcdabcdabcd";

export const EMPRESA_DE_ORIGEM: EmpresaDeOrigem = {
  sourceClientId: CLIENTE_DE_ORIGEM,
  name: "EMPRESA SINTETICA 999901 LTDA",
  active: true,
  linkedOrganization: null
};

export const EMPRESA_JA_IMPORTADA: EmpresaDeOrigem = {
  sourceClientId: 999903,
  name: "EMPRESA SINTETICA 999903 LTDA",
  active: true,
  linkedOrganization: {
    organizationPublicId: ORG_PUBLIC_ID,
    legalName: "EMPRESA SINTETICA LTDA",
    type: "COMPANY",
    status: "ACTIVE"
  }
};

export const PAGINA_EMPRESAS: PaginaCatalogo<EmpresaDeOrigem> = {
  items: [EMPRESA_DE_ORIGEM, EMPRESA_JA_IMPORTADA],
  total: 2,
  limit: 25,
  offset: 0
};

export const USUARIO_ELEGIVEL: UsuarioDeOrigem = {
  sourceUserId: 999911,
  name: "Externo Sintetico Um",
  email: "externo.um.999901@example.invalid",
  role: "cliente",
  active: true,
  sourceClientId: CLIENTE_DE_ORIGEM,
  eligible: true,
  ineligibilityReasons: [],
  linkedIdentity: null,
  suggestedSelected: true
};

export const USUARIO_ELEGIVEL_DOIS: UsuarioDeOrigem = {
  ...USUARIO_ELEGIVEL,
  sourceUserId: 999912,
  name: "Externo Sintetico Dois",
  email: "externo.dois.999901@example.invalid"
};

/** Interno da mesma empresa — aparece na lista, marcado como inelegível. */
export const USUARIO_INTERNO: UsuarioDeOrigem = {
  sourceUserId: 999913,
  name: "Atendente Sintetico",
  email: "atendente.999901@example.invalid",
  role: "atendente",
  active: true,
  sourceClientId: CLIENTE_DE_ORIGEM,
  eligible: false,
  ineligibilityReasons: ["SOURCE_USER_NOT_EXTERNAL_ROLE"],
  linkedIdentity: null,
  suggestedSelected: false
};

export const USUARIOS_DE_ORIGEM: UsuariosDeOrigem = {
  sourceClientId: CLIENTE_DE_ORIGEM,
  items: [USUARIO_ELEGIVEL, USUARIO_ELEGIVEL_DOIS, USUARIO_INTERNO],
  total: 3,
  eligibleTotal: 2,
  alreadyImportedTotal: 0
};

function itemProposto(entityKind: string, action: string, reasonCode: string, fields: Record<string, unknown>): ItemProposto {
  return {
    entityKind,
    action,
    reasonCode,
    before: null,
    after: { fields, redactedFields: [] }
  };
}

function usuarioProposto(sourceLegacyId: number, name: string, email: string, action: string, reasonCode: string): UsuarioProposto {
  return {
    sourceLegacyId,
    name,
    email,
    linkKind: "COMPANY",
    writes: action === "CREATE",
    existingIdentityPublicId: null,
    items: [
      itemProposto("IDENTITY", action, reasonCode, { full_name: name, email }),
      itemProposto("IDENTITY_EXTERNAL_REFERENCE", action, reasonCode, { legacy_id: sourceLegacyId }),
      itemProposto("MEMBERSHIP", action, reasonCode, { profile: "CUSTOMER", scope: "ORGANIZATION_ONLY" }),
      itemProposto("APPLICATION_ACCESS", action, reasonCode, { application_code: "PCTEC_HELPDESK", access_profile: "USER" })
    ]
  };
}

export const PREVIA: PreviaDaImportacao = {
  mappingRulesVersion: "helpdesk-wizard-v1",
  applyConfirmationWord: "APLICAR",
  source: { sourceClientId: CLIENTE_DE_ORIGEM, name: EMPRESA_DE_ORIGEM.name, active: true },
  organization: {
    resolution: "ABSENT",
    publicId: null,
    legalName: EMPRESA_DE_ORIGEM.name,
    type: "COMPANY",
    status: null,
    assertionConflict: null,
    blockingReasonCode: null,
    actions: [
      itemProposto("ORGANIZATION", "CREATE", "CREATED_FROM_SOURCE", { legal_name: EMPRESA_DE_ORIGEM.name }),
      itemProposto("ORGANIZATION_EXTERNAL_REFERENCE", "CREATE", "CREATED_FROM_SOURCE", { legacy_id: CLIENTE_DE_ORIGEM })
    ]
  },
  businessGroup: null,
  countsByAction: { CREATE: 10, SKIP: 0, CONFLICT: 0, QUARANTINE: 0 },
  writes: true,
  users: [
    usuarioProposto(999911, USUARIO_ELEGIVEL.name, USUARIO_ELEGIVEL.email, "CREATE", "CREATED_FROM_SOURCE"),
    usuarioProposto(999912, USUARIO_ELEGIVEL_DOIS.name, USUARIO_ELEGIVEL_DOIS.email, "CREATE", "CREATED_FROM_SOURCE")
  ]
};

/** Prévia com um usuário em CONFLICT e outro em QUARANTINE. */
export const PREVIA_COM_PROBLEMAS: PreviaDaImportacao = {
  ...PREVIA,
  countsByAction: { CREATE: 2, SKIP: 0, CONFLICT: 4, QUARANTINE: 4 },
  users: [
    usuarioProposto(999911, USUARIO_ELEGIVEL.name, USUARIO_ELEGIVEL.email, "CONFLICT", "EMAIL_MATCHES_EXISTING_IDENTITY"),
    usuarioProposto(999912, USUARIO_ELEGIVEL_DOIS.name, USUARIO_ELEGIVEL_DOIS.email, "QUARANTINE", "SOURCE_EMAIL_INVALID")
  ]
};

/** Prévia com a organização bloqueada — o lote inteiro fica em espera. */
export const PREVIA_ORGANIZACAO_BLOQUEADA: PreviaDaImportacao = {
  ...PREVIA,
  organization: {
    ...PREVIA.organization,
    resolution: "EXTERNAL_REFERENCE",
    blockingReasonCode: "ORGANIZATION_ASSERTION_CONFLICT",
    assertionConflict: "referência externa ativa já aponta para outra organização",
    actions: [
      itemProposto("ORGANIZATION", "CONFLICT", "ORGANIZATION_ASSERTION_CONFLICT", { legal_name: EMPRESA_DE_ORIGEM.name }),
      itemProposto("ORGANIZATION_EXTERNAL_REFERENCE", "CONFLICT", "ORGANIZATION_ASSERTION_CONFLICT", {
        legacy_id: CLIENTE_DE_ORIGEM
      })
    ]
  },
  countsByAction: { CREATE: 0, SKIP: 0, CONFLICT: 2, QUARANTINE: 8 },
  writes: false
};

/** Prévia de reexecução: tudo já existe, nada a escrever. */
export const PREVIA_SEM_ESCRITA: PreviaDaImportacao = {
  ...PREVIA,
  countsByAction: { CREATE: 0, SKIP: 10, CONFLICT: 0, QUARANTINE: 0 },
  writes: false,
  users: [
    usuarioProposto(999911, USUARIO_ELEGIVEL.name, USUARIO_ELEGIVEL.email, "SKIP", "EXTERNAL_REFERENCE_ALREADY_ACTIVE"),
    usuarioProposto(999912, USUARIO_ELEGIVEL_DOIS.name, USUARIO_ELEGIVEL_DOIS.email, "SKIP", "EXTERNAL_REFERENCE_ALREADY_ACTIVE")
  ]
};

function resultadoUsuario(sourceLegacyId: number, sourceName: string, sourceEmail: string, acao: string): ResultadoUsuario {
  const escreveu = acao === "CREATE";
  return {
    sourceLegacyId,
    sourceName,
    sourceEmail,
    linkKind: "COMPANY",
    actionsByEntityKind: {
      IDENTITY: acao,
      IDENTITY_EXTERNAL_REFERENCE: acao,
      MEMBERSHIP: acao,
      APPLICATION_ACCESS: acao
    },
    reasonCodes: [escreveu ? "CREATED_FROM_SOURCE" : "EMAIL_MATCHES_EXISTING_IDENTITY"],
    writtenTargets: escreveu
      ? {
          IDENTITY: NOVA_IDENTIDADE_PUBLIC_ID,
          MEMBERSHIP: NOVA_MEMBERSHIP_PUBLIC_ID,
          APPLICATION_ACCESS: NOVO_ACESSO_PUBLIC_ID
        }
      : {},
    identityStatus: escreveu ? "ACTIVE" : null,
    activatedNow: escreveu
  };
}

export const LOTE_DRY_RUN: ResultadoDaImportacao = {
  batchPublicId: LOTE_DRY_RUN_PUBLIC_ID,
  mode: "DRY_RUN",
  status: "COMPLETED",
  sourceClientId: CLIENTE_DE_ORIGEM,
  sourceClientName: EMPRESA_DE_ORIGEM.name,
  organizationResolution: "ABSENT",
  organizationPublicId: null,
  organizationLegalName: EMPRESA_DE_ORIGEM.name,
  parentBusinessGroupPublicId: null,
  scopeFingerprint: "a".repeat(64),
  mappingRulesVersion: "helpdesk-wizard-v1",
  countsByAction: { CREATE: 10, SKIP: 0, CONFLICT: 0, QUARANTINE: 0 },
  organizationActions: { ORGANIZATION: "CREATE", ORGANIZATION_EXTERNAL_REFERENCE: "CREATE" },
  organizationTargets: {},
  blockingReasonCode: null,
  users: [
    resultadoUsuario(999911, USUARIO_ELEGIVEL.name, USUARIO_ELEGIVEL.email, "CREATE"),
    resultadoUsuario(999912, USUARIO_ELEGIVEL_DOIS.name, USUARIO_ELEGIVEL_DOIS.email, "CREATE")
  ],
  recordedItems: 10,
  resumedUsers: []
};

export const LOTE_DRY_RUN_COM_PROBLEMAS: ResultadoDaImportacao = {
  ...LOTE_DRY_RUN,
  countsByAction: { CREATE: 2, SKIP: 0, CONFLICT: 4, QUARANTINE: 4 },
  users: [
    resultadoUsuario(999911, USUARIO_ELEGIVEL.name, USUARIO_ELEGIVEL.email, "CONFLICT"),
    resultadoUsuario(999912, USUARIO_ELEGIVEL_DOIS.name, USUARIO_ELEGIVEL_DOIS.email, "QUARANTINE")
  ]
};

export const LOTE_DRY_RUN_BLOQUEADO: ResultadoDaImportacao = {
  ...LOTE_DRY_RUN,
  blockingReasonCode: "ORGANIZATION_ASSERTION_CONFLICT",
  countsByAction: { CREATE: 0, SKIP: 0, CONFLICT: 2, QUARANTINE: 8 },
  organizationActions: { ORGANIZATION: "CONFLICT", ORGANIZATION_EXTERNAL_REFERENCE: "CONFLICT" }
};

export const LOTE_DRY_RUN_SEM_ESCRITA: ResultadoDaImportacao = {
  ...LOTE_DRY_RUN,
  countsByAction: { CREATE: 0, SKIP: 10, CONFLICT: 0, QUARANTINE: 0 },
  organizationActions: { ORGANIZATION: "SKIP", ORGANIZATION_EXTERNAL_REFERENCE: "SKIP" },
  users: [
    resultadoUsuario(999911, USUARIO_ELEGIVEL.name, USUARIO_ELEGIVEL.email, "SKIP"),
    resultadoUsuario(999912, USUARIO_ELEGIVEL_DOIS.name, USUARIO_ELEGIVEL_DOIS.email, "SKIP")
  ]
};

export const LOTE_APLICADO: ResultadoDaImportacao = {
  ...LOTE_DRY_RUN,
  batchPublicId: LOTE_APPLY_PUBLIC_ID,
  mode: "APPLY",
  organizationResolution: "ABSENT",
  organizationPublicId: NOVA_ORG_PUBLIC_ID,
  organizationTargets: { ORGANIZATION: NOVA_ORG_PUBLIC_ID }
};
