import type {
  TargetApplication,
  TargetApplicationAccessSummary,
  TargetExternalReferenceSummary,
  TargetIdentitySummary,
  TargetMembershipSummary,
  TargetOrganization
} from "../pilot/IngressaTargetState.js";

export type {
  TargetApplication,
  TargetApplicationAccessSummary,
  TargetExternalReferenceSummary,
  TargetIdentitySummary,
  TargetMembershipSummary,
  TargetOrganization
};

export interface TargetOrganizationRelationshipSummary {
  readonly publicId: string;
  readonly parentOrganizationPublicId: string;
  readonly childOrganizationPublicId: string;
}

export interface TargetOrganizationExternalReferenceSummary {
  readonly publicId: string;
  readonly organizationPublicId: string;
  readonly legacyId: string;
  readonly status: string;
}

/**
 * Como a Organization de destino foi RESOLVIDA — e é a informação mais
 * importante desta estrutura.
 *
 * O piloto não precisava disto porque a organização era pré-condição:
 * ou o `publicId` afirmado existia, ou a execução parava. O assistente
 * pode criar a empresa que falta, então "de onde veio este destino?"
 * deixa de ser óbvio e passa a ser a diferença entre reaproveitar a
 * empresa certa e criar uma duplicata silenciosa.
 *
 *  - `EXTERNAL_REFERENCE` — existe `OrganizationExternalReference`
 *    ACTIVE de `PCTEC_HELPDESK`/`clients` para este `clients.id`. É a
 *    única resolução que o sistema faz sozinho, porque é a única
 *    baseada num vínculo que alguém já afirmou antes.
 *  - `OPERATOR_ASSERTED` — o ADMIN apontou o `publicId`. A referência
 *    externa ainda não existe e será criada, amarrando a associação
 *    para as próximas execuções.
 *  - `ABSENT` — nada resolve o destino; a empresa será criada.
 *
 * Não existe resolução por NOME, e não existe por documento: o grant
 * read-only da fonte projeta `clients(id, name, active)` e nada mais —
 * não há CNPJ vindo da origem para gerar candidato. Casar por razão
 * social transformaria um `UPDATE clients SET name` do Helpdesk em
 * mudança de quem tem acesso a quê.
 */
export type OrganizationResolutionKind = "EXTERNAL_REFERENCE" | "OPERATOR_ASSERTED" | "ABSENT";

export interface ResolvedTargetOrganization {
  readonly kind: OrganizationResolutionKind;
  /** `undefined` quando `kind === "ABSENT"` — a empresa ainda não existe. */
  readonly organization: TargetOrganization | undefined;
  /** Referência externa ACTIVE que resolveu o destino, quando houve uma. */
  readonly externalReference: TargetOrganizationExternalReferenceSummary | undefined;
  /**
   * Preenchido quando o ADMIN afirmou um `publicId` que NÃO confere com
   * o que a referência externa já diz. Vira CONFLICT, nunca correção
   * automática: mudar a empresa de destino de um cliente já importado é
   * decisão de quem concedeu, não do importador.
   */
  readonly assertionConflict: string | undefined;
}

/**
 * Grupo empresarial de destino, quando o ADMIN afirmou um.
 *
 * `eligible` é `false` para grupo inexistente, de tipo errado ou
 * INACTIVE — e a razão de guardar o motivo em vez de lançar é que a
 * tela precisa mostrar o problema no item, junto do resto da revisão,
 * em vez de devolver um erro que apaga todo o resto do plano.
 */
export interface ResolvedTargetBusinessGroup {
  readonly publicId: string;
  readonly organization: TargetOrganization | undefined;
  readonly eligible: boolean;
  readonly ineligibleReason: string | undefined;
  /** Relação já existente cujo filho é a empresa deste lote. */
  readonly existingRelationship: TargetOrganizationRelationshipSummary | undefined;
}

/**
 * Retrato do DESTINO no instante da decisão — versão do assistente.
 *
 * Mesmo contrato do `IngressaTargetState` do piloto para tudo que diz
 * respeito a pessoa, mais o que o piloto não tinha: a resolução da
 * organização, o grupo afirmado e a relação existente.
 */
export interface WizardTargetState {
  readonly resolvedOrganization: ResolvedTargetOrganization;
  readonly businessGroup: ResolvedTargetBusinessGroup | undefined;
  readonly application: TargetApplication;
  /** Chave: `legacyId` como string (PCTEC_HELPDESK/users, status ACTIVE). */
  readonly externalReferencesByLegacyId: ReadonlyMap<string, TargetExternalReferenceSummary>;
  /** Chave: e-mail normalizado. */
  readonly identitiesByEmailNormalized: ReadonlyMap<string, TargetIdentitySummary>;
  /** Chave: `identityPublicId`. */
  readonly identitiesByPublicId: ReadonlyMap<string, TargetIdentitySummary>;
  /** Chave: `identityPublicId` — memberships ATIVAS na EMPRESA resolvida. */
  readonly membershipsByIdentityPublicId: ReadonlyMap<string, TargetMembershipSummary>;
  /**
   * Chave: `identityPublicId` — memberships ATIVAS no GRUPO afirmado.
   *
   * Mapa separado, não fundido com o da empresa, porque as duas
   * perguntas são diferentes: "esta pessoa já pertence à empresa?" e
   * "esta pessoa já pertence ao grupo?" têm respostas independentes, e
   * um mapa único faria uma responder pela outra conforme a ordem de
   * leitura — que é como se concede escopo errado sem ninguém notar.
   */
  readonly groupMembershipsByIdentityPublicId: ReadonlyMap<string, TargetMembershipSummary>;
  /** Chave: `identityPublicId` — acessos GRANTED na aplicação do assistente. */
  readonly applicationAccessesByIdentityPublicId: ReadonlyMap<string, TargetApplicationAccessSummary>;
  /** Contagens totais por entidade, para `counts_before`. */
  readonly counts: Readonly<Record<string, number>>;
}
