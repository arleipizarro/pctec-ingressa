/**
 * Retrato do DESTINO no instante da decisão.
 *
 * O planner é uma função pura: recebe origem e destino já lidos e
 * devolve decisões. Nada aqui é opcional por conveniência — se o
 * destino não pôde ser resolvido, o runner falha antes de planejar, em
 * vez de deixar o planner adivinhar.
 */
export interface TargetOrganization {
  readonly publicId: string;
  readonly legalName: string;
  readonly type: string;
  readonly status: string;
}

export interface TargetApplication {
  readonly publicId: string;
  readonly code: string;
  readonly status: string;
}

export interface TargetIdentitySummary {
  readonly publicId: string;
  readonly fullName: string;
  readonly emailNormalized: string;
  readonly status: string;
}

export interface TargetExternalReferenceSummary {
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly legacyId: string;
  readonly matchMethod: string;
  readonly status: string;
}

export interface TargetMembershipSummary {
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly profile: string;
  readonly scope: string;
  readonly status: string;
}

export interface TargetApplicationAccessSummary {
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly applicationPublicId: string;
  readonly accessProfile: string;
  readonly status: string;
}

export interface IngressaTargetState {
  /** Resolvida pelo `publicId` afirmado pelo operador — nunca por nome. */
  readonly organization: TargetOrganization;
  readonly application: TargetApplication;
  /** Chave: `legacyId` como string (PCTEC_HELPDESK/users, status ACTIVE). */
  readonly externalReferencesByLegacyId: ReadonlyMap<string, TargetExternalReferenceSummary>;
  /** Chave: e-mail normalizado. */
  readonly identitiesByEmailNormalized: ReadonlyMap<string, TargetIdentitySummary>;
  /** Chave: `identityPublicId`. */
  readonly identitiesByPublicId: ReadonlyMap<string, TargetIdentitySummary>;
  /** Chave: `identityPublicId` — somente memberships ATIVAS na organização do piloto. */
  readonly membershipsByIdentityPublicId: ReadonlyMap<string, TargetMembershipSummary>;
  /** Chave: `identityPublicId` — somente acessos GRANTED na aplicação do piloto. */
  readonly applicationAccessesByIdentityPublicId: ReadonlyMap<string, TargetApplicationAccessSummary>;
  /** Contagens totais por entidade, para `counts_before`. */
  readonly counts: Readonly<Record<string, number>>;
}
