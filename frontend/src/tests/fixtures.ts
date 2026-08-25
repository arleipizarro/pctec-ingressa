/**
 * Fixtures da UI — TODAS sintéticas.
 *
 * Nenhum nome, e-mail ou empresa real entra aqui. Domínio
 * `@example.invalid` é reservado por RFC e não entrega mensagem a
 * ninguém; o teste-guarda `semPiiNasFixtures.test.ts` falha se alguém
 * colar um endereço real numa fixture.
 */
import type { IdentidadeDetalhe, OrganizacaoDetalhe, Pagina, Identidade, Lote, ItemDeLote, Resumo, Organizacao } from "../api.js";

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
