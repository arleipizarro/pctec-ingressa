import type { HelpdeskClientRecord, HelpdeskUserRecord } from "../domain/pilot/HelpdeskSourcePort.js";
import type {
  ResolvedTargetBusinessGroup,
  ResolvedTargetOrganization,
  TargetApplicationAccessSummary,
  TargetExternalReferenceSummary,
  TargetIdentitySummary,
  TargetMembershipSummary,
  TargetOrganization,
  WizardTargetState
} from "../domain/wizard/WizardTargetState.js";

/**
 * Construtores de estado para os testes do assistente.
 *
 * Todos os dados são SINTÉTICOS: `@example.invalid` é domínio reservado
 * por RFC e não entrega mensagem a ninguém, e os ids ficam na faixa
 * `9999xx`, longe dos ids operacionais reais da origem. O teste-guarda
 * `HelpdeskWizardFixturesPiiGuard` falha se alguém colar dado real
 * aqui.
 */
export const ORG_PUBLIC_ID = "aaaaaaa1-0000-4000-8000-000000000001";
export const GRUPO_PUBLIC_ID = "aaaaaaa2-0000-4000-8000-000000000002";
export const APLICACAO_PUBLIC_ID = "aaaaaaa3-0000-4000-8000-000000000003";
export const REF_ORG_PUBLIC_ID = "aaaaaaa4-0000-4000-8000-000000000004";
export const RELACAO_PUBLIC_ID = "aaaaaaa5-0000-4000-8000-000000000005";
export const IDENTIDADE_PUBLIC_ID = "aaaaaaa6-0000-4000-8000-000000000006";
export const MEMBERSHIP_PUBLIC_ID = "aaaaaaa7-0000-4000-8000-000000000007";
export const ACESSO_PUBLIC_ID = "aaaaaaa8-0000-4000-8000-000000000008";
export const REF_IDENTIDADE_PUBLIC_ID = "aaaaaaa9-0000-4000-8000-000000000009";
export const OUTRA_ORG_PUBLIC_ID = "aaaaaab1-0000-4000-8000-000000000011";

export const CLIENTE_ID = 999901;

export const CLIENTE: HelpdeskClientRecord = {
  id: CLIENTE_ID,
  name: "EMPRESA SINTETICA 999901 LTDA",
  active: true
};

export const EMPRESA: TargetOrganization = {
  publicId: ORG_PUBLIC_ID,
  legalName: CLIENTE.name,
  type: "COMPANY",
  status: "ACTIVE"
};

export const GRUPO: TargetOrganization = {
  publicId: GRUPO_PUBLIC_ID,
  legalName: "GRUPO SINTETICO 999901",
  type: "BUSINESS_GROUP",
  status: "ACTIVE"
};

export function usuario(overrides: Partial<HelpdeskUserRecord> = {}): HelpdeskUserRecord {
  return {
    id: 999911,
    name: "Externo Sintetico Um",
    email: "externo.um.999901@example.invalid",
    role: "cliente",
    active: true,
    clientId: CLIENTE_ID,
    ...overrides
  };
}

export function organizacaoAusente(): ResolvedTargetOrganization {
  return { kind: "ABSENT", organization: undefined, externalReference: undefined, assertionConflict: undefined };
}

export function organizacaoJaVinculada(
  organizacao: TargetOrganization = EMPRESA,
  assertionConflict?: string
): ResolvedTargetOrganization {
  return {
    kind: "EXTERNAL_REFERENCE",
    organization: organizacao,
    externalReference: {
      publicId: REF_ORG_PUBLIC_ID,
      organizationPublicId: organizacao.publicId,
      legacyId: String(CLIENTE_ID),
      status: "ACTIVE"
    },
    ...(assertionConflict === undefined ? {} : { assertionConflict })
  } as ResolvedTargetOrganization;
}

export function organizacaoAfirmada(organizacao: TargetOrganization = EMPRESA): ResolvedTargetOrganization {
  return {
    kind: "OPERATOR_ASSERTED",
    organization: organizacao,
    externalReference: undefined,
    assertionConflict: undefined
  };
}

/**
 * Afirmação que o leitor NÃO conseguiu resolver: o `publicId` existe no
 * pedido mas não corresponde a uma COMPANY ACTIVE.
 *
 * Helper próprio em vez de `organizacaoAfirmada(undefined)` porque o
 * parâmetro com default engoliria o `undefined` explícito e o teste
 * provaria o contrário do que pretende — foi exatamente o que
 * aconteceu ao escrever isto.
 */
export function organizacaoAfirmadaNaoResolvida(): ResolvedTargetOrganization {
  return {
    kind: "OPERATOR_ASSERTED",
    organization: undefined,
    externalReference: undefined,
    assertionConflict: undefined
  };
}

export function grupoElegivel(
  existingRelationship?: ResolvedTargetBusinessGroup["existingRelationship"]
): ResolvedTargetBusinessGroup {
  return {
    publicId: GRUPO_PUBLIC_ID,
    organization: GRUPO,
    eligible: true,
    ineligibleReason: undefined,
    existingRelationship
  };
}

export function grupoInelegivel(motivo = "status=INACTIVE"): ResolvedTargetBusinessGroup {
  return {
    publicId: GRUPO_PUBLIC_ID,
    organization: { ...GRUPO, status: "INACTIVE" },
    eligible: false,
    ineligibleReason: motivo,
    existingRelationship: undefined
  };
}

export function relacaoExistente(parentPublicId = GRUPO_PUBLIC_ID) {
  return {
    publicId: RELACAO_PUBLIC_ID,
    parentOrganizationPublicId: parentPublicId,
    childOrganizationPublicId: ORG_PUBLIC_ID
  };
}

export interface TargetOverrides {
  readonly resolvedOrganization?: ResolvedTargetOrganization;
  readonly businessGroup?: ResolvedTargetBusinessGroup | undefined;
  readonly externalReferencesByLegacyId?: ReadonlyMap<string, TargetExternalReferenceSummary>;
  readonly identitiesByEmailNormalized?: ReadonlyMap<string, TargetIdentitySummary>;
  readonly identitiesByPublicId?: ReadonlyMap<string, TargetIdentitySummary>;
  readonly membershipsByIdentityPublicId?: ReadonlyMap<string, TargetMembershipSummary>;
  readonly groupMembershipsByIdentityPublicId?: ReadonlyMap<string, TargetMembershipSummary>;
  readonly applicationAccessesByIdentityPublicId?: ReadonlyMap<string, TargetApplicationAccessSummary>;
  readonly counts?: Readonly<Record<string, number>>;
}

export function alvo(overrides: TargetOverrides = {}): WizardTargetState {
  return {
    resolvedOrganization: overrides.resolvedOrganization ?? organizacaoAusente(),
    businessGroup: overrides.businessGroup,
    application: { publicId: APLICACAO_PUBLIC_ID, code: "PCTEC_HELPDESK", status: "ACTIVE" },
    externalReferencesByLegacyId: overrides.externalReferencesByLegacyId ?? new Map(),
    identitiesByEmailNormalized: overrides.identitiesByEmailNormalized ?? new Map(),
    identitiesByPublicId: overrides.identitiesByPublicId ?? new Map(),
    membershipsByIdentityPublicId: overrides.membershipsByIdentityPublicId ?? new Map(),
    groupMembershipsByIdentityPublicId: overrides.groupMembershipsByIdentityPublicId ?? new Map(),
    applicationAccessesByIdentityPublicId: overrides.applicationAccessesByIdentityPublicId ?? new Map(),
    counts: overrides.counts ?? {
      organizations: 3,
      organizationRelationships: 1,
      organizationExternalReferences: 2,
      identities: 3,
      identityExternalReferences: 1,
      memberships: 2,
      applicationAccesses: 4
    }
  };
}

/** Usuário já importado: referência ativa + Identity idêntica à origem. */
export function jaImportado(user: HelpdeskUserRecord, extras: TargetOverrides = {}): TargetOverrides {
  const identidade: TargetIdentitySummary = {
    publicId: IDENTIDADE_PUBLIC_ID,
    fullName: user.name,
    emailNormalized: user.email.trim().toLowerCase(),
    status: "ACTIVE"
  };
  return {
    externalReferencesByLegacyId: new Map([
      [
        String(user.id),
        {
          publicId: REF_IDENTIDADE_PUBLIC_ID,
          identityPublicId: IDENTIDADE_PUBLIC_ID,
          legacyId: String(user.id),
          matchMethod: "CREATED_FROM_SOURCE",
          status: "ACTIVE"
        }
      ]
    ]),
    identitiesByPublicId: new Map([[IDENTIDADE_PUBLIC_ID, identidade]]),
    identitiesByEmailNormalized: new Map([[identidade.emailNormalized, identidade]]),
    ...extras
  };
}

export function membershipAtiva(
  organizationPublicId = ORG_PUBLIC_ID,
  scope = "ORGANIZATION_ONLY"
): ReadonlyMap<string, TargetMembershipSummary> {
  return new Map([
    [
      IDENTIDADE_PUBLIC_ID,
      {
        publicId: MEMBERSHIP_PUBLIC_ID,
        identityPublicId: IDENTIDADE_PUBLIC_ID,
        organizationPublicId,
        profile: "CUSTOMER",
        scope,
        status: "ACTIVE"
      }
    ]
  ]);
}

export function acessoConcedido(): ReadonlyMap<string, TargetApplicationAccessSummary> {
  return new Map([
    [
      IDENTIDADE_PUBLIC_ID,
      {
        publicId: ACESSO_PUBLIC_ID,
        identityPublicId: IDENTIDADE_PUBLIC_ID,
        applicationPublicId: APLICACAO_PUBLIC_ID,
        accessProfile: "USER",
        status: "GRANTED"
      }
    ]
  ]);
}
