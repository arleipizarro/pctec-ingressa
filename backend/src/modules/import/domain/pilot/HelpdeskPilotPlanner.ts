import { Email } from "../../../identity/domain/value-objects/Email.js";
import type { HelpdeskClientRecord, HelpdeskUserRecord } from "./HelpdeskSourcePort.js";
import type { IngressaTargetState } from "./IngressaTargetState.js";
import {
  assertInPilotScope,
  PILOT_ACCESS_PROFILE,
  PILOT_MEMBERSHIP_PROFILE,
  PILOT_MEMBERSHIP_SCOPE,
  PILOT_SOURCE_ENTITY,
  PILOT_SOURCE_ROLE
} from "./HelpdeskPilotScope.js";

export type PlannedEntityKind =
  | "IDENTITY"
  | "IDENTITY_EXTERNAL_REFERENCE"
  | "MEMBERSHIP"
  | "APPLICATION_ACCESS";

/** Ordem de escrita no APPLY. A compensação percorre o inverso. */
export const PLAN_ENTITY_ORDER: readonly PlannedEntityKind[] = Object.freeze([
  "IDENTITY",
  "IDENTITY_EXTERNAL_REFERENCE",
  "MEMBERSHIP",
  "APPLICATION_ACCESS"
]);

/**
 * `UPDATE` não está aqui, e a ausência é a correção mais importante
 * desta versão das regras. O apply não sabe executar atualização de
 * Identity — não existe `UpdateIdentityService` — e um planner que
 * propõe o que o executor não faz produz lote que ninguém consegue
 * aprovar: o operador revisa, aprova, e o apply recusa no meio.
 * Divergência de cadastro agora vira QUARANTINE, que é o que ela sempre
 * foi de fato: caso que espera decisão humana.
 */
export type PlannedAction = "CREATE" | "SKIP" | "CONFLICT" | "QUARANTINE";

export interface PlannedItem {
  readonly entityKind: PlannedEntityKind;
  readonly sourceEntityType: string;
  readonly sourceLegacyId: number;
  readonly action: PlannedAction;
  readonly reasonCode: string;
  /** Campos já filtrados — nunca a linha de origem. */
  readonly before: Readonly<Record<string, string | number | boolean | null>> | undefined;
  readonly after: Readonly<Record<string, string | number | boolean | null>> | undefined;
  /** Preenchido só no APPLY, depois da escrita. */
  readonly existingTargetPublicId: string | undefined;
}

export interface UserPlan {
  readonly sourceLegacyId: number;
  readonly emailNormalized: string;
  readonly items: readonly PlannedItem[];
  /** `true` quando o APPLY escreveria alguma coisa para este usuário. */
  readonly writes: boolean;
}

export interface PilotPlan {
  readonly users: readonly UserPlan[];
  readonly items: readonly PlannedItem[];
  readonly countsByAction: Readonly<Record<PlannedAction, number>>;
}

/** Campos do snapshot `after` de uma Identity proposta. */
export const IDENTITY_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "source_legacy_id",
  "full_name",
  "email",
  "email_normalized",
  "source_role",
  "source_active"
]);

export const EXTERNAL_REFERENCE_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "system_code",
  "entity_type",
  "legacy_id",
  "match_method",
  "status"
]);

/**
 * A associação afirmada pelo operador é persistida AQUI, item a item:
 * `source_client_id` (origem) ao lado de `organization_public_id`
 * (destino), com os dois nomes observados para leitura humana. Quem
 * auditar o lote daqui a um ano vê a associação que valia na hora, sem
 * depender do nome atual de nenhuma das duas pontas.
 */
export const MEMBERSHIP_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "organization_public_id",
  "organization_legal_name",
  "profile",
  "scope",
  "status",
  "source_client_id",
  "source_client_name"
]);

export const APPLICATION_ACCESS_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "application_code",
  "application_public_id",
  "access_profile",
  "status"
]);

export interface PlanInput {
  readonly users: readonly HelpdeskUserRecord[];
  readonly client: HelpdeskClientRecord | undefined;
  /** `clients.id` do Helpdesk que o piloto aceita como vínculo. */
  readonly expectedSourceClientId: number;
  readonly target: IngressaTargetState;
}

/**
 * Motivos — texto estável, cabe em `reason_code` VARCHAR(64).
 */
export const REASON = {
  createdFromSource: "CREATED_FROM_SOURCE",
  alreadyLinked: "EXTERNAL_REFERENCE_ALREADY_ACTIVE",
  membershipAlreadyActive: "MEMBERSHIP_ALREADY_ACTIVE",
  accessAlreadyGranted: "APPLICATION_ACCESS_ALREADY_GRANTED",
  identityUpdateUnsupported: "IDENTITY_UPDATE_UNSUPPORTED",
  emailBelongsToAnotherIdentity: "EMAIL_MATCHES_EXISTING_IDENTITY",
  membershipScopeDiverged: "MEMBERSHIP_SCOPE_DIVERGED",
  sourceInactive: "SOURCE_USER_INACTIVE",
  sourceNotExternal: "SOURCE_USER_NOT_EXTERNAL_ROLE",
  sourceWithoutClient: "SOURCE_USER_WITHOUT_CLIENT_LINK",
  sourceClientOutOfPilot: "SOURCE_CLIENT_OUT_OF_PILOT_SCOPE",
  sourceClientMissing: "SOURCE_CLIENT_NOT_FOUND",
  sourceClientInactive: "SOURCE_CLIENT_INACTIVE"
} as const;

/**
 * Planejador do piloto — FUNÇÃO PURA.
 *
 * Não lê banco, não escreve, não conhece transação. Recebe o retrato da
 * origem e o do destino e devolve a lista de decisões. É o que permite
 * cobrir com teste unitário os casos que em produção seriam raros e
 * caros de reproduzir: e-mail colidindo, membership com escopo errado,
 * cliente inativo na origem.
 *
 * Duas regras estruturam tudo:
 *
 *  1. **Escopo antes de decisão.** Todo registro passa por
 *     `assertInPilotScope` antes de qualquer avaliação. Um usuário fora
 *     do escopo não vira SKIP — ele derruba a execução, porque a
 *     presença dele já significa que a leitura saiu do combinado.
 *
 *  2. **Fail-closed por usuário, nunca parcial.** Quando um usuário cai
 *     em CONFLICT ou QUARANTINE, TODAS as quatro entidades dele recebem
 *     a mesma decisão. Aplicar metade — criar a Identity e parar antes
 *     do acesso — deixa no banco uma pessoa sem vínculo que ninguém
 *     pediu e ninguém revisou.
 */
export function planPilotImport(input: PlanInput): PilotPlan {
  const users = [...input.users].sort((a, b) => a.id - b.id);
  for (const user of users) {
    assertInPilotScope(user.id);
  }

  const planos = users.map((user) => planUser(user, input));
  const items = planos.flatMap((plano) => plano.items);

  const countsByAction: Record<PlannedAction, number> = {
    CREATE: 0,
    SKIP: 0,
    CONFLICT: 0,
    QUARANTINE: 0
  };
  for (const item of items) {
    countsByAction[item.action] += 1;
  }

  return { users: planos, items, countsByAction };
}

function planUser(user: HelpdeskUserRecord, input: PlanInput): UserPlan {
  const emailNormalized = Email.create(user.email).normalized();
  const bloqueio = avaliarElegibilidade(user, input);

  if (bloqueio !== undefined) {
    return montarPlanoUniforme(user, emailNormalized, "QUARANTINE", bloqueio, input);
  }

  const referencia = input.target.externalReferencesByLegacyId.get(String(user.id));

  if (referencia === undefined) {
    const identidadeHomonima = input.target.identitiesByEmailNormalized.get(emailNormalized);
    if (identidadeHomonima !== undefined) {
      // Fail-closed: o e-mail bate, mas nada prova que é a MESMA pessoa.
      // Associar por e-mail é a regra que o Ingressa aceita só quando
      // um humano confirma (`MATCHED_MANUAL_CONFIRMED`) — o importador
      // não tem autoridade para decidir isso sozinho.
      return montarPlanoUniforme(
        user,
        emailNormalized,
        "CONFLICT",
        REASON.emailBelongsToAnotherIdentity,
        input
      );
    }
    return montarPlanoDeCriacao(user, emailNormalized, input);
  }

  return montarPlanoDeReconciliacao(user, emailNormalized, referencia.identityPublicId, input);
}

/**
 * Elegibilidade do registro de ORIGEM. Devolve o motivo do bloqueio, ou
 * `undefined` quando o usuário pode ser decidido.
 */
function avaliarElegibilidade(user: HelpdeskUserRecord, input: PlanInput): string | undefined {
  if (!user.active) {
    return REASON.sourceInactive;
  }
  if (user.role !== PILOT_SOURCE_ROLE) {
    return REASON.sourceNotExternal;
  }
  if (user.clientId === null) {
    return REASON.sourceWithoutClient;
  }
  if (user.clientId !== input.expectedSourceClientId) {
    return REASON.sourceClientOutOfPilot;
  }
  if (input.client === undefined) {
    return REASON.sourceClientMissing;
  }
  if (!input.client.active) {
    return REASON.sourceClientInactive;
  }
  // O NOME do cliente não é chave de decisão nenhuma. Ele é observado e
  // vai para o snapshot, para que quem lê o relatório veja qual empresa
  // da origem foi associada a qual Organization — mas quem afirma a
  // associação é o operador, via `--expected-source-client-id` e
  // `--target-organization-public-id`, e quem a valida é o banco.
  return undefined;
}

function montarPlanoDeCriacao(
  user: HelpdeskUserRecord,
  emailNormalized: string,
  input: PlanInput
): UserPlan {
  const items: PlannedItem[] = [
    item(user, "IDENTITY", "CREATE", REASON.createdFromSource, undefined, snapshotIdentidade(user, emailNormalized)),
    item(
      user,
      "IDENTITY_EXTERNAL_REFERENCE",
      "CREATE",
      REASON.createdFromSource,
      undefined,
      snapshotReferencia(user)
    ),
    item(user, "MEMBERSHIP", "CREATE", REASON.createdFromSource, undefined, snapshotMembership(user, input)),
    item(user, "APPLICATION_ACCESS", "CREATE", REASON.createdFromSource, undefined, snapshotAcesso(input))
  ];
  return { sourceLegacyId: user.id, emailNormalized, items, writes: true };
}

/**
 * Usuário já vinculado por IdentityExternalReference ativa: cada
 * entidade é comparada individualmente — o vínculo não está em dúvida,
 * só o conteúdo pode ter mudado. Se o conteúdo da Identity mudou, o
 * usuário inteiro vai para QUARANTINE (ver acima); as demais entidades
 * podem ser criadas ou puladas isoladamente.
 */
function montarPlanoDeReconciliacao(
  user: HelpdeskUserRecord,
  emailNormalized: string,
  identityPublicId: string,
  input: PlanInput
): UserPlan {
  const identidade = input.target.identitiesByPublicId.get(identityPublicId);
  const membership = input.target.membershipsByIdentityPublicId.get(identityPublicId);
  const acesso = input.target.applicationAccessesByIdentityPublicId.get(identityPublicId);

  const identidadeDivergiu =
    identidade !== undefined &&
    (identidade.fullName !== user.name || identidade.emailNormalized !== emailNormalized);

  if (identidadeDivergiu) {
    // Fail-closed no usuário inteiro: o cadastro da origem mudou e não
    // há como refletir a mudança no destino. Registrar SKIP nas outras
    // três entidades faria o relatório afirmar "está tudo certo" sobre
    // uma pessoa cujo cadastro está fora de sincronia.
    return montarPlanoUniforme(
      user,
      emailNormalized,
      "QUARANTINE",
      REASON.identityUpdateUnsupported,
      input
    );
  }

  const itemIdentidade = item(
    user,
    "IDENTITY",
    "SKIP",
    REASON.alreadyLinked,
    undefined,
    snapshotIdentidade(user, emailNormalized),
    identityPublicId
  );

  const itemReferencia = item(
    user,
    "IDENTITY_EXTERNAL_REFERENCE",
    "SKIP",
    REASON.alreadyLinked,
    undefined,
    snapshotReferencia(user),
    identityPublicId
  );

  let itemMembership: PlannedItem;
  if (membership === undefined) {
    itemMembership = item(
      user,
      "MEMBERSHIP",
      "CREATE",
      REASON.createdFromSource,
      undefined,
      snapshotMembership(user, input)
    );
  } else if (membership.scope !== PILOT_MEMBERSHIP_SCOPE) {
    // Escopo mais amplo do que o piloto concede nunca é "corrigido"
    // silenciosamente: reduzir escopo é decisão de quem concedeu.
    itemMembership = item(
      user,
      "MEMBERSHIP",
      "CONFLICT",
      REASON.membershipScopeDiverged,
      {
        organization_public_id: membership.organizationPublicId,
        profile: membership.profile,
        scope: membership.scope,
        status: membership.status
      },
      snapshotMembership(user, input),
      membership.publicId
    );
  } else {
    itemMembership = item(
      user,
      "MEMBERSHIP",
      "SKIP",
      REASON.membershipAlreadyActive,
      undefined,
      snapshotMembership(user, input),
      membership.publicId
    );
  }

  const itemAcesso =
    acesso === undefined
      ? item(user, "APPLICATION_ACCESS", "CREATE", REASON.createdFromSource, undefined, snapshotAcesso(input))
      : item(
          user,
          "APPLICATION_ACCESS",
          "SKIP",
          REASON.accessAlreadyGranted,
          undefined,
          snapshotAcesso(input),
          acesso.publicId
        );

  const items = [itemIdentidade, itemReferencia, itemMembership, itemAcesso];
  return {
    sourceLegacyId: user.id,
    emailNormalized,
    items,
    writes: items.some((i) => i.action === "CREATE")
  };
}

/** CONFLICT e QUARANTINE valem para o usuário inteiro — nunca por entidade. */
function montarPlanoUniforme(
  user: HelpdeskUserRecord,
  emailNormalized: string,
  action: PlannedAction,
  reasonCode: string,
  input: PlanInput
): UserPlan {
  const items = PLAN_ENTITY_ORDER.map((kind) => {
    const after =
      kind === "IDENTITY"
        ? snapshotIdentidade(user, emailNormalized)
        : kind === "IDENTITY_EXTERNAL_REFERENCE"
          ? snapshotReferencia(user)
          : kind === "MEMBERSHIP"
            ? snapshotMembership(user, input)
            : snapshotAcesso(input);
    return item(user, kind, action, reasonCode, undefined, after);
  });
  return { sourceLegacyId: user.id, emailNormalized, items, writes: false };
}

function item(
  user: HelpdeskUserRecord,
  entityKind: PlannedEntityKind,
  action: PlannedAction,
  reasonCode: string,
  before: Readonly<Record<string, string | number | boolean | null>> | undefined,
  after: Readonly<Record<string, string | number | boolean | null>> | undefined,
  existingTargetPublicId?: string
): PlannedItem {
  return {
    entityKind,
    sourceEntityType: PILOT_SOURCE_ENTITY,
    sourceLegacyId: user.id,
    action,
    reasonCode,
    before,
    after,
    existingTargetPublicId
  };
}

function snapshotIdentidade(
  user: HelpdeskUserRecord,
  emailNormalized: string
): Readonly<Record<string, string | number | boolean | null>> {
  return {
    source_legacy_id: user.id,
    full_name: user.name,
    email: user.email,
    email_normalized: emailNormalized,
    source_role: user.role,
    source_active: user.active
  };
}

function snapshotReferencia(
  user: HelpdeskUserRecord
): Readonly<Record<string, string | number | boolean | null>> {
  return {
    system_code: "PCTEC_HELPDESK",
    entity_type: PILOT_SOURCE_ENTITY,
    legacy_id: user.id,
    match_method: "CREATED_FROM_SOURCE",
    status: "ACTIVE"
  };
}

function snapshotMembership(
  user: HelpdeskUserRecord,
  input: PlanInput
): Readonly<Record<string, string | number | boolean | null>> {
  return {
    organization_public_id: input.target.organization.publicId,
    organization_legal_name: input.target.organization.legalName,
    profile: PILOT_MEMBERSHIP_PROFILE,
    scope: PILOT_MEMBERSHIP_SCOPE,
    status: "ACTIVE",
    source_client_id: user.clientId,
    source_client_name: input.client?.name ?? null
  };
}

function snapshotAcesso(input: PlanInput): Readonly<Record<string, string | number | boolean | null>> {
  return {
    application_code: input.target.application.code,
    application_public_id: input.target.application.publicId,
    access_profile: PILOT_ACCESS_PROFILE,
    status: "GRANTED"
  };
}
