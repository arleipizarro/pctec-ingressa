import { Email } from "../../../identity/domain/value-objects/Email.js";
import type { HelpdeskClientRecord, HelpdeskUserRecord } from "../pilot/HelpdeskSourcePort.js";
import type { HelpdeskImportSelection } from "./HelpdeskImportSelection.js";
import type { WizardTargetState } from "./WizardTargetState.js";
import {
  SelectedSourceUserMissingError,
  UnselectedSourceUserLeakError,
  WIZARD_ACCESS_PROFILE,
  WIZARD_APPLICATION_CODE,
  WIZARD_MEMBERSHIP_PROFILE,
  WIZARD_ORGANIZATION_TYPE_BUSINESS_GROUP,
  WIZARD_ORGANIZATION_TYPE_COMPANY,
  WIZARD_SOURCE_CLIENT_ENTITY,
  WIZARD_SOURCE_EXTERNAL_ROLE,
  WIZARD_SOURCE_SYSTEM,
  WIZARD_SOURCE_USER_ENTITY
} from "./HelpdeskImportScope.js";

export type PlannedEntityKind =
  | "ORGANIZATION"
  | "ORGANIZATION_EXTERNAL_REFERENCE"
  | "ORGANIZATION_RELATIONSHIP"
  | "IDENTITY"
  | "IDENTITY_EXTERNAL_REFERENCE"
  | "MEMBERSHIP"
  | "APPLICATION_ACCESS";

export type PlannedAction = "CREATE" | "SKIP" | "CONFLICT" | "QUARANTINE";

/**
 * Ordem de escrita no APPLY — e ela não é estética.
 *
 * A empresa precisa existir antes da membership que aponta para ela, e
 * a referência externa precisa existir antes de a próxima execução
 * conseguir reaproveitar a empresa. A relação grupo→empresa vem depois
 * da empresa, pelo mesmo motivo.
 */
export const ORGANIZATION_ENTITY_ORDER: readonly PlannedEntityKind[] = Object.freeze([
  "ORGANIZATION",
  "ORGANIZATION_EXTERNAL_REFERENCE",
  "ORGANIZATION_RELATIONSHIP"
]);

export const USER_ENTITY_ORDER: readonly PlannedEntityKind[] = Object.freeze([
  "IDENTITY",
  "IDENTITY_EXTERNAL_REFERENCE",
  "MEMBERSHIP",
  "APPLICATION_ACCESS"
]);

export type SnapshotFields = Readonly<Record<string, string | number | boolean | null>>;

export interface PlannedItem {
  readonly entityKind: PlannedEntityKind;
  readonly sourceEntityType: string;
  readonly sourceLegacyId: number;
  readonly action: PlannedAction;
  readonly reasonCode: string;
  readonly before: SnapshotFields | undefined;
  readonly after: SnapshotFields | undefined;
  /** Alvo que JÁ existe no Ingressa — nunca o que o apply vai criar. */
  readonly existingTargetPublicId: string | undefined;
}

/**
 * Vínculo cadastral que autoriza a Organization do usuário.
 *
 * `COMPANY` é o único que a fonte Helpdesk produz hoje (`users.client_id`).
 * `BUSINESS_GROUP` existe porque o mapeamento pedido pela task é real e
 * está implementado — o que falta para alcançá-lo não é código, é
 * leitura: `users.client_group_id` não está no grant read-only e o
 * cadastro de grupo vive em `pctecdb`, banco do HUB (ver
 * `HelpdeskCatalogPort`). Quando essa leitura existir, ela produz este
 * tipo e o resto do caminho já está pronto e coberto por teste.
 */
export type SourceOrganizationLinkKind = "COMPANY" | "BUSINESS_GROUP";

/**
 * Escopo da membership é FUNÇÃO do vínculo, nunca escolha de tela.
 *
 * Empresa concede acesso à empresa. Grupo concede acesso ao grupo e ao
 * que está abaixo dele. Deixar a UI escolher o escopo permitiria
 * conceder `AND_DESCENDANTS` a partir de um vínculo de empresa — que é
 * a definição de escalada de privilégio por interface.
 */
export function membershipScopeFor(kind: SourceOrganizationLinkKind): string {
  return kind === "BUSINESS_GROUP" ? "ORGANIZATION_AND_DESCENDANTS" : "ORGANIZATION_ONLY";
}

export interface UserPlan {
  readonly sourceLegacyId: number;
  readonly sourceName: string;
  readonly sourceEmail: string;
  readonly emailNormalized: string;
  readonly linkKind: SourceOrganizationLinkKind;
  readonly items: readonly PlannedItem[];
  /** `true` quando o APPLY escreveria alguma coisa para este usuário. */
  readonly writes: boolean;
  /** Identity de destino JÁ existente, quando o vínculo a resolveu. */
  readonly existingIdentityPublicId: string | undefined;
}

export interface OrganizationPlan {
  readonly sourceClientId: number;
  readonly items: readonly PlannedItem[];
  readonly writes: boolean;
  /**
   * `undefined` quando a empresa ainda não existe — o apply resolve o
   * `publicId` depois de criá-la. É por isso que o membership do
   * usuário nunca carrega o destino no plano: ele é resolvido na
   * transação, não no papel.
   */
  readonly existingOrganizationPublicId: string | undefined;
  /** Bloqueio que impede qualquer escrita neste lote. */
  readonly blockingReasonCode: string | undefined;
}

export interface ImportPlan {
  readonly organization: OrganizationPlan;
  readonly users: readonly UserPlan[];
  readonly items: readonly PlannedItem[];
  readonly countsByAction: Readonly<Record<PlannedAction, number>>;
  readonly writes: boolean;
}

export const ORGANIZATION_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "organization_public_id",
  "type",
  "legal_name",
  "status",
  "source_client_id",
  "source_client_name",
  "source_client_active",
  "resolution"
]);

export const ORGANIZATION_EXTERNAL_REFERENCE_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "system_code",
  "entity_type",
  "legacy_id",
  "organization_public_id",
  "status"
]);

export const ORGANIZATION_RELATIONSHIP_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "parent_organization_public_id",
  "parent_legal_name",
  "child_organization_public_id",
  "child_legal_name",
  "source_client_id"
]);

export const IDENTITY_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "source_legacy_id",
  "full_name",
  "email",
  "email_normalized",
  "source_role",
  "source_active"
]);

export const IDENTITY_EXTERNAL_REFERENCE_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "system_code",
  "entity_type",
  "legacy_id",
  "match_method",
  "status"
]);

export const MEMBERSHIP_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "organization_public_id",
  "organization_legal_name",
  "profile",
  "scope",
  "status",
  "link_kind",
  "source_client_id",
  "source_client_name"
]);

export const APPLICATION_ACCESS_SNAPSHOT_FIELDS: readonly string[] = Object.freeze([
  "application_code",
  "application_public_id",
  "access_profile",
  "status"
]);

export function allowedSnapshotFieldsFor(entityKind: string): readonly string[] {
  switch (entityKind) {
    case "ORGANIZATION":
      return ORGANIZATION_SNAPSHOT_FIELDS;
    case "ORGANIZATION_EXTERNAL_REFERENCE":
      return ORGANIZATION_EXTERNAL_REFERENCE_SNAPSHOT_FIELDS;
    case "ORGANIZATION_RELATIONSHIP":
      return ORGANIZATION_RELATIONSHIP_SNAPSHOT_FIELDS;
    case "IDENTITY":
      return IDENTITY_SNAPSHOT_FIELDS;
    case "IDENTITY_EXTERNAL_REFERENCE":
      return IDENTITY_EXTERNAL_REFERENCE_SNAPSHOT_FIELDS;
    case "MEMBERSHIP":
      return MEMBERSHIP_SNAPSHOT_FIELDS;
    default:
      return APPLICATION_ACCESS_SNAPSHOT_FIELDS;
  }
}

/** Motivos — texto estável, cabe em `reason_code` VARCHAR(64). */
export const REASON = {
  createdFromSource: "CREATED_FROM_SOURCE",
  organizationAlreadyLinked: "ORGANIZATION_ALREADY_LINKED",
  organizationAssertionConflict: "ORGANIZATION_ASSERTION_CONFLICT",
  organizationNotEligible: "ORGANIZATION_NOT_ELIGIBLE",
  organizationNotResolved: "ORGANIZATION_NOT_RESOLVED",
  relationshipAlreadyActive: "ORGANIZATION_RELATIONSHIP_ALREADY_ACTIVE",
  relationshipParentDiverged: "ORGANIZATION_RELATIONSHIP_PARENT_DIVERGED",
  businessGroupNotEligible: "BUSINESS_GROUP_NOT_ELIGIBLE",
  businessGroupNotAsserted: "BUSINESS_GROUP_NOT_ASSERTED",
  externalReferenceAlreadyActive: "EXTERNAL_REFERENCE_ALREADY_ACTIVE",
  membershipAlreadyActive: "MEMBERSHIP_ALREADY_ACTIVE",
  membershipScopeDiverged: "MEMBERSHIP_SCOPE_DIVERGED",
  accessAlreadyGranted: "APPLICATION_ACCESS_ALREADY_GRANTED",
  identityUpdateUnsupported: "IDENTITY_UPDATE_UNSUPPORTED",
  emailBelongsToAnotherIdentity: "EMAIL_MATCHES_EXISTING_IDENTITY",
  sourceInactive: "SOURCE_USER_INACTIVE",
  sourceNotExternal: "SOURCE_USER_NOT_EXTERNAL_ROLE",
  sourceWithoutClient: "SOURCE_USER_WITHOUT_CLIENT_LINK",
  sourceClientOutOfSelection: "SOURCE_USER_CLIENT_OUT_OF_SELECTION",
  sourceEmailInvalid: "SOURCE_EMAIL_INVALID",
  sourceEmailDuplicated: "SOURCE_EMAIL_DUPLICATED_IN_SELECTION",
  sourceClientInactive: "SOURCE_CLIENT_INACTIVE"
} as const;

export interface PlanInput {
  readonly selection: HelpdeskImportSelection;
  readonly users: readonly HelpdeskUserRecord[];
  readonly client: HelpdeskClientRecord;
  readonly target: WizardTargetState;
  /**
   * Vínculo que autoriza a Organization de cada usuário.
   *
   * Recebido em vez de deduzido para que o caminho de grupo seja
   * exercitável por teste hoje — o conector atual só produz `COMPANY`
   * (ver `HelpdeskCatalogPort`), e um `default` escondido no planner
   * tornaria o outro ramo código morto que ninguém verifica.
   */
  readonly linkKindBySourceUserId?: ReadonlyMap<number, SourceOrganizationLinkKind> | undefined;
}

/**
 * Planejador do assistente — FUNÇÃO PURA.
 *
 * Não lê banco, não escreve, não conhece transação nem sessão. Recebe o
 * retrato da origem, a seleção do ADMIN e o retrato do destino, e
 * devolve a lista de decisões.
 *
 * Três regras estruturam tudo, e as três são herdadas do piloto porque
 * já provaram valer:
 *
 *  1. **Seleção antes de decisão.** Todo registro devolvido pela fonte
 *     passa por `assertOnlySelected` antes de qualquer avaliação. Um
 *     usuário fora da seleção não vira SKIP — ele derruba a execução,
 *     porque a presença dele já significa que a leitura saiu do que o
 *     ADMIN marcou na tela.
 *
 *  2. **Fail-closed por usuário, nunca parcial.** Quando um usuário cai
 *     em CONFLICT ou QUARANTINE, TODAS as quatro entidades dele recebem
 *     a mesma decisão. Aplicar metade deixaria no banco uma pessoa sem
 *     vínculo que ninguém pediu e ninguém revisou.
 *
 *  3. **Organização bloqueada bloqueia o lote.** Membership e acesso
 *     dependem da empresa. Se a empresa não pôde ser resolvida sem
 *     ambiguidade, nenhum usuário é escrito — em vez de escrever os que
 *     "dariam" e deixar o resto para depois.
 */
export function planImport(input: PlanInput): ImportPlan {
  assertOnlySelected(input.users, input.selection);
  assertSelectionComplete(input.users, input.selection);

  const organization = planOrganization(input);
  const emailsDuplicados = detectarEmailsDuplicados(input.users);

  const users = [...input.users]
    .sort((a, b) => a.id - b.id)
    .map((user) => planUser(user, input, organization, emailsDuplicados));

  const items = [...organization.items, ...users.flatMap((u) => u.items)];

  const countsByAction: Record<PlannedAction, number> = {
    CREATE: 0,
    SKIP: 0,
    CONFLICT: 0,
    QUARANTINE: 0
  };
  for (const item of items) {
    countsByAction[item.action] += 1;
  }

  return {
    organization,
    users,
    items,
    countsByAction,
    writes: organization.writes || users.some((u) => u.writes)
  };
}

/**
 * A porta pela qual todo id da fonte passa antes de virar decisão.
 *
 * É o herdeiro do controle negativo do piloto. Lá, o usuário 45 tinha
 * que estar ausente do lote porque não estava na constante de escopo;
 * aqui, qualquer usuário da empresa que o ADMIN não marcou tem que
 * estar ausente pela mesma razão — e um SKIP registrado sobre ele já
 * seria prova de que o assistente decidiu sobre quem ninguém escolheu.
 */
export function assertOnlySelected(
  users: readonly HelpdeskUserRecord[],
  selection: HelpdeskImportSelection
): void {
  const intrusos = users.filter((u) => !selection.includes(u.id)).map((u) => u.id);
  if (intrusos.length > 0) {
    throw new UnselectedSourceUserLeakError(intrusos);
  }
}

function assertSelectionComplete(
  users: readonly HelpdeskUserRecord[],
  selection: HelpdeskImportSelection
): void {
  const encontrados = new Set(users.map((u) => u.id));
  const faltando = selection.getSelectedSourceUserIds().filter((id) => !encontrados.has(id));
  if (faltando.length > 0) {
    throw new SelectedSourceUserMissingError(faltando);
  }
}

/**
 * E-mail repetido DENTRO da seleção.
 *
 * Duas linhas da origem com o mesmo endereço não são duas pessoas com
 * um detalhe em comum: ou é a mesma pessoa cadastrada duas vezes, ou é
 * um cadastro errado. Criar duas Identities resolveria a execução e
 * deixaria o problema — e a segunda ainda colidiria com a primeira na
 * unicidade de e-mail. Ambas vão para CONFLICT.
 */
function detectarEmailsDuplicados(users: readonly HelpdeskUserRecord[]): ReadonlySet<string> {
  const contagem = new Map<string, number>();
  for (const user of users) {
    const normalizado = normalizarEmail(user.email);
    if (normalizado === undefined) {
      continue;
    }
    contagem.set(normalizado, (contagem.get(normalizado) ?? 0) + 1);
  }
  return new Set([...contagem.entries()].filter(([, total]) => total > 1).map(([email]) => email));
}

function normalizarEmail(bruto: string): string | undefined {
  try {
    return Email.create(bruto).normalized();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------
// Organização
// ---------------------------------------------------------------------

/**
 * Plano da empresa e do que a acompanha.
 *
 * Três decisões independentes, nesta ordem: a Organization em si, a
 * referência externa que a amarra ao `clients.id` da origem, e a
 * relação com o grupo empresarial quando o ADMIN afirmou um.
 *
 * O bloqueio é a parte que interessa: `blockingReasonCode` preenchido
 * significa que NENHUM usuário deste lote pode ser escrito. Não é
 * excesso de zelo — membership e acesso apontam para a empresa, e
 * escrevê-los com o destino em dúvida é como conceder acesso "mais ou
 * menos" à empresa certa.
 */
function planOrganization(input: PlanInput): OrganizationPlan {
  const { client, target, selection } = input;
  const resolucao = target.resolvedOrganization;
  const clientId = selection.getSourceClientId();

  const itens: PlannedItem[] = [];

  // A empresa inativa na origem nunca vira empresa ativa no destino.
  if (!client.active) {
    return bloquearOrganizacao(input, REASON.sourceClientInactive, "QUARANTINE");
  }

  // O ADMIN afirmou uma organização e a referência externa diz outra.
  if (resolucao.assertionConflict !== undefined) {
    return bloquearOrganizacao(input, REASON.organizationAssertionConflict, "CONFLICT");
  }

  const organizacao = resolucao.organization;

  if (resolucao.kind !== "ABSENT" && organizacao === undefined) {
    // Resolução afirmou um destino que não existe ou não é elegível.
    return bloquearOrganizacao(input, REASON.organizationNotEligible, "CONFLICT");
  }

  if (organizacao !== undefined) {
    itens.push(
      item(
        "ORGANIZATION",
        WIZARD_SOURCE_CLIENT_ENTITY,
        clientId,
        "SKIP",
        resolucao.kind === "EXTERNAL_REFERENCE" ? REASON.organizationAlreadyLinked : REASON.createdFromSource,
        undefined,
        snapshotOrganizacao(input, organizacao.publicId, resolucao.kind),
        organizacao.publicId
      )
    );
  } else {
    itens.push(
      item(
        "ORGANIZATION",
        WIZARD_SOURCE_CLIENT_ENTITY,
        clientId,
        "CREATE",
        REASON.createdFromSource,
        undefined,
        snapshotOrganizacao(input, null, resolucao.kind)
      )
    );
  }

  // Referência externa: só é SKIP quando ela JÁ existe e está ACTIVE.
  // Nos outros dois caminhos ela é criada — inclusive quando o ADMIN
  // afirmou uma organização existente, porque é essa criação que faz a
  // próxima execução resolver sozinha o que hoje depende de alguém
  // digitar o `publicId` certo.
  const referencia = resolucao.externalReference;
  itens.push(
    referencia !== undefined
      ? item(
          "ORGANIZATION_EXTERNAL_REFERENCE",
          WIZARD_SOURCE_CLIENT_ENTITY,
          clientId,
          "SKIP",
          REASON.externalReferenceAlreadyActive,
          undefined,
          snapshotReferenciaOrganizacao(clientId, referencia.organizationPublicId),
          referencia.publicId
        )
      : item(
          "ORGANIZATION_EXTERNAL_REFERENCE",
          WIZARD_SOURCE_CLIENT_ENTITY,
          clientId,
          "CREATE",
          REASON.createdFromSource,
          undefined,
          snapshotReferenciaOrganizacao(clientId, organizacao?.publicId ?? null)
        )
  );

  const grupo = target.businessGroup;
  if (grupo !== undefined) {
    if (!grupo.eligible) {
      return bloquearOrganizacao(input, REASON.businessGroupNotEligible, "CONFLICT");
    }
    const existente = grupo.existingRelationship;
    if (existente === undefined) {
      itens.push(
        item(
          "ORGANIZATION_RELATIONSHIP",
          WIZARD_SOURCE_CLIENT_ENTITY,
          clientId,
          "CREATE",
          REASON.createdFromSource,
          undefined,
          snapshotRelacao(input, grupo.publicId, grupo.organization?.legalName ?? null, organizacao)
        )
      );
    } else if (existente.parentOrganizationPublicId !== grupo.publicId) {
      // Uma COMPANY pertence a no máximo um BUSINESS_GROUP (migration
      // 0011, `uk_org_rel_child`). Trocar o pai é decisão de quem
      // organizou o cadastro, nunca efeito colateral de uma importação.
      return bloquearOrganizacao(input, REASON.relationshipParentDiverged, "CONFLICT");
    } else {
      itens.push(
        item(
          "ORGANIZATION_RELATIONSHIP",
          WIZARD_SOURCE_CLIENT_ENTITY,
          clientId,
          "SKIP",
          REASON.relationshipAlreadyActive,
          undefined,
          snapshotRelacao(input, grupo.publicId, grupo.organization?.legalName ?? null, organizacao),
          existente.publicId
        )
      );
    }
  }

  return {
    sourceClientId: clientId,
    items: itens,
    writes: itens.some((i) => i.action === "CREATE"),
    existingOrganizationPublicId: organizacao?.publicId,
    blockingReasonCode: undefined
  };
}

/**
 * Bloqueio uniforme da organização: as três entidades recebem a mesma
 * decisão, pelo mesmo motivo, e o lote inteiro fica sem escrita.
 */
function bloquearOrganizacao(
  input: PlanInput,
  reasonCode: string,
  action: Extract<PlannedAction, "CONFLICT" | "QUARANTINE">
): OrganizationPlan {
  const clientId = input.selection.getSourceClientId();
  const resolucao = input.target.resolvedOrganization;
  const organizacao = resolucao.organization;
  const grupo = input.target.businessGroup;

  const itens: PlannedItem[] = [
    item(
      "ORGANIZATION",
      WIZARD_SOURCE_CLIENT_ENTITY,
      clientId,
      action,
      reasonCode,
      organizacao === undefined
        ? undefined
        : {
            organization_public_id: organizacao.publicId,
            type: organizacao.type,
            legal_name: organizacao.legalName,
            status: organizacao.status
          },
      snapshotOrganizacao(input, organizacao?.publicId ?? null, resolucao.kind),
      organizacao?.publicId
    ),
    item(
      "ORGANIZATION_EXTERNAL_REFERENCE",
      WIZARD_SOURCE_CLIENT_ENTITY,
      clientId,
      action,
      reasonCode,
      undefined,
      snapshotReferenciaOrganizacao(clientId, organizacao?.publicId ?? null),
      resolucao.externalReference?.publicId
    )
  ];

  if (grupo !== undefined) {
    itens.push(
      item(
        "ORGANIZATION_RELATIONSHIP",
        WIZARD_SOURCE_CLIENT_ENTITY,
        clientId,
        action,
        reasonCode,
        grupo.existingRelationship === undefined
          ? undefined
          : {
              parent_organization_public_id: grupo.existingRelationship.parentOrganizationPublicId,
              child_organization_public_id: grupo.existingRelationship.childOrganizationPublicId
            },
        snapshotRelacao(input, grupo.publicId, grupo.organization?.legalName ?? null, organizacao),
        grupo.existingRelationship?.publicId
      )
    );
  }

  return {
    sourceClientId: clientId,
    items: itens,
    writes: false,
    existingOrganizationPublicId: organizacao?.publicId,
    blockingReasonCode: reasonCode
  };
}

// ---------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------

function planUser(
  user: HelpdeskUserRecord,
  input: PlanInput,
  organizacao: OrganizationPlan,
  emailsDuplicados: ReadonlySet<string>
): UserPlan {
  const linkKind = input.linkKindBySourceUserId?.get(user.id) ?? "COMPANY";
  const emailNormalizado = normalizarEmail(user.email);

  // E-mail que não vira `Email` não vira Identity: o normalizado é a
  // chave de unicidade do destino, e sem ele não há como afirmar sequer
  // que esta pessoa é diferente das que já estão lá.
  if (emailNormalizado === undefined) {
    return uniforme(user, "", linkKind, "QUARANTINE", REASON.sourceEmailInvalid, input, organizacao);
  }

  if (organizacao.blockingReasonCode !== undefined) {
    // Empresa em dúvida: ninguém é escrito. O motivo registrado é o da
    // organização, não um genérico — quem revisa precisa chegar na
    // causa pelo item do usuário, sem ter que cruzar o lote inteiro.
    return uniforme(
      user,
      emailNormalizado,
      linkKind,
      "QUARANTINE",
      REASON.organizationNotResolved,
      input,
      organizacao
    );
  }

  if (emailsDuplicados.has(emailNormalizado)) {
    return uniforme(user, emailNormalizado, linkKind, "CONFLICT", REASON.sourceEmailDuplicated, input, organizacao);
  }

  if (linkKind === "BUSINESS_GROUP" && input.target.businessGroup === undefined) {
    // Vínculo de grupo sem grupo de destino afirmado não tem para onde
    // conceder. Inventar a empresa como destino reduziria o escopo
    // silenciosamente — e escopo reduzido também é escopo errado.
    return uniforme(
      user,
      emailNormalizado,
      linkKind,
      "QUARANTINE",
      REASON.businessGroupNotAsserted,
      input,
      organizacao
    );
  }

  const bloqueio = avaliarElegibilidade(user, input);
  if (bloqueio !== undefined) {
    return uniforme(user, emailNormalizado, linkKind, "QUARANTINE", bloqueio, input, organizacao);
  }

  const referencia = input.target.externalReferencesByLegacyId.get(String(user.id));

  if (referencia === undefined) {
    const homonima = input.target.identitiesByEmailNormalized.get(emailNormalizado);
    if (homonima !== undefined) {
      // Fail-closed: o e-mail bate, mas nada prova que é a MESMA pessoa.
      // Associar por e-mail é regra que o Ingressa aceita só quando um
      // humano confirma (`MATCHED_MANUAL_CONFIRMED`); o importador não
      // tem autoridade para decidir isso sozinho.
      return uniforme(
        user,
        emailNormalizado,
        linkKind,
        "CONFLICT",
        REASON.emailBelongsToAnotherIdentity,
        input,
        organizacao
      );
    }
    return planoDeCriacao(user, emailNormalizado, linkKind, input, organizacao);
  }

  return planoDeReconciliacao(user, emailNormalizado, linkKind, referencia.identityPublicId, input, organizacao);
}

/** Elegibilidade do registro de ORIGEM. `undefined` = pode ser decidido. */
function avaliarElegibilidade(user: HelpdeskUserRecord, input: PlanInput): string | undefined {
  if (!user.active) {
    return REASON.sourceInactive;
  }
  // Usuário INTERNO (`admin`, `atendente`) nunca recebe membership em
  // cliente por importação. O papel dele diz que ele atende empresas —
  // não que ele pertence a uma.
  if (user.role !== WIZARD_SOURCE_EXTERNAL_ROLE) {
    return REASON.sourceNotExternal;
  }
  if (user.clientId === null) {
    return REASON.sourceWithoutClient;
  }
  if (user.clientId !== input.selection.getSourceClientId()) {
    return REASON.sourceClientOutOfSelection;
  }
  return undefined;
}

function planoDeCriacao(
  user: HelpdeskUserRecord,
  emailNormalizado: string,
  linkKind: SourceOrganizationLinkKind,
  input: PlanInput,
  organizacao: OrganizationPlan
): UserPlan {
  const items: PlannedItem[] = [
    itemDeUsuario(user, "IDENTITY", "CREATE", REASON.createdFromSource, undefined, snapshotIdentidade(user, emailNormalizado)),
    itemDeUsuario(
      user,
      "IDENTITY_EXTERNAL_REFERENCE",
      "CREATE",
      REASON.createdFromSource,
      undefined,
      snapshotReferenciaIdentidade(user)
    ),
    itemDeUsuario(
      user,
      "MEMBERSHIP",
      "CREATE",
      REASON.createdFromSource,
      undefined,
      snapshotMembership(user, linkKind, input, organizacao)
    ),
    itemDeUsuario(user, "APPLICATION_ACCESS", "CREATE", REASON.createdFromSource, undefined, snapshotAcesso(input))
  ];
  return {
    sourceLegacyId: user.id,
    sourceName: user.name,
    sourceEmail: user.email,
    emailNormalized: emailNormalizado,
    linkKind,
    items,
    writes: true,
    existingIdentityPublicId: undefined
  };
}

/**
 * Usuário já vinculado por `IdentityExternalReference` ativa.
 *
 * Este é o caminho do "usuário já importado deve resultar em SKIP, não
 * duplicação": o vínculo não está em dúvida, então cada entidade é
 * comparada individualmente. O que ainda falta é criado; o que já está
 * lá é pulado.
 */
function planoDeReconciliacao(
  user: HelpdeskUserRecord,
  emailNormalizado: string,
  linkKind: SourceOrganizationLinkKind,
  identityPublicId: string,
  input: PlanInput,
  organizacao: OrganizationPlan
): UserPlan {
  const identidade = input.target.identitiesByPublicId.get(identityPublicId);
  const membership =
    linkKind === "BUSINESS_GROUP"
      ? input.target.groupMembershipsByIdentityPublicId.get(identityPublicId)
      : input.target.membershipsByIdentityPublicId.get(identityPublicId);
  const acesso = input.target.applicationAccessesByIdentityPublicId.get(identityPublicId);

  const divergiu =
    identidade !== undefined &&
    (identidade.fullName !== user.name || identidade.emailNormalized !== emailNormalizado);

  if (divergiu) {
    // O apply não sabe executar UPDATE de Identity, e propor o que não
    // se sabe aplicar produz lote impossível de aprovar. Divergência de
    // cadastro é o que sempre foi: caso que espera decisão humana.
    return uniforme(
      user,
      emailNormalizado,
      linkKind,
      "QUARANTINE",
      REASON.identityUpdateUnsupported,
      input,
      organizacao,
      identityPublicId
    );
  }

  const escopoEsperado = membershipScopeFor(linkKind);

  const itemIdentidade = itemDeUsuario(
    user,
    "IDENTITY",
    "SKIP",
    REASON.externalReferenceAlreadyActive,
    undefined,
    snapshotIdentidade(user, emailNormalizado),
    identityPublicId
  );
  const itemReferencia = itemDeUsuario(
    user,
    "IDENTITY_EXTERNAL_REFERENCE",
    "SKIP",
    REASON.externalReferenceAlreadyActive,
    undefined,
    snapshotReferenciaIdentidade(user),
    identityPublicId
  );

  let itemMembership: PlannedItem;
  if (membership === undefined) {
    itemMembership = itemDeUsuario(
      user,
      "MEMBERSHIP",
      "CREATE",
      REASON.createdFromSource,
      undefined,
      snapshotMembership(user, linkKind, input, organizacao)
    );
  } else if (membership.scope !== escopoEsperado) {
    // Escopo diferente do que este vínculo concede nunca é "corrigido"
    // em silêncio: reduzir escopo é decisão de quem concedeu, e ampliar
    // seria conceder mais do que a origem autoriza.
    itemMembership = itemDeUsuario(
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
      snapshotMembership(user, linkKind, input, organizacao),
      membership.publicId
    );
  } else {
    itemMembership = itemDeUsuario(
      user,
      "MEMBERSHIP",
      "SKIP",
      REASON.membershipAlreadyActive,
      undefined,
      snapshotMembership(user, linkKind, input, organizacao),
      membership.publicId
    );
  }

  const itemAcesso =
    acesso === undefined
      ? itemDeUsuario(user, "APPLICATION_ACCESS", "CREATE", REASON.createdFromSource, undefined, snapshotAcesso(input))
      : itemDeUsuario(
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
    sourceName: user.name,
    sourceEmail: user.email,
    emailNormalized: emailNormalizado,
    linkKind,
    items,
    // CONFLICT em qualquer entidade zera a escrita do usuário inteiro:
    // criar o acesso de alguém cuja membership está em conflito é
    // exatamente a concessão parcial não auditada que a task proíbe.
    writes: items.some((i) => i.action === "CREATE") && !items.some((i) => i.action === "CONFLICT"),
    existingIdentityPublicId: identityPublicId
  };
}

/** CONFLICT e QUARANTINE valem para o usuário inteiro — nunca por entidade. */
function uniforme(
  user: HelpdeskUserRecord,
  emailNormalizado: string,
  linkKind: SourceOrganizationLinkKind,
  action: Extract<PlannedAction, "CONFLICT" | "QUARANTINE">,
  reasonCode: string,
  input: PlanInput,
  organizacao: OrganizationPlan,
  existingIdentityPublicId?: string
): UserPlan {
  const items = USER_ENTITY_ORDER.map((kind) =>
    itemDeUsuario(
      user,
      kind,
      action,
      reasonCode,
      undefined,
      snapshotDaEntidade(kind, user, emailNormalizado, linkKind, input, organizacao),
      kind === "IDENTITY" ? existingIdentityPublicId : undefined
    )
  );
  return {
    sourceLegacyId: user.id,
    sourceName: user.name,
    sourceEmail: user.email,
    emailNormalized: emailNormalizado,
    linkKind,
    items,
    writes: false,
    existingIdentityPublicId
  };
}

function snapshotDaEntidade(
  kind: PlannedEntityKind,
  user: HelpdeskUserRecord,
  emailNormalizado: string,
  linkKind: SourceOrganizationLinkKind,
  input: PlanInput,
  organizacao: OrganizationPlan
): SnapshotFields {
  switch (kind) {
    case "IDENTITY":
      return snapshotIdentidade(user, emailNormalizado);
    case "IDENTITY_EXTERNAL_REFERENCE":
      return snapshotReferenciaIdentidade(user);
    case "MEMBERSHIP":
      return snapshotMembership(user, linkKind, input, organizacao);
    default:
      return snapshotAcesso(input);
  }
}

// ---------------------------------------------------------------------
// Snapshots — campos já filtrados, nunca a linha de origem
// ---------------------------------------------------------------------

function item(
  entityKind: PlannedEntityKind,
  sourceEntityType: string,
  sourceLegacyId: number,
  action: PlannedAction,
  reasonCode: string,
  before: SnapshotFields | undefined,
  after: SnapshotFields | undefined,
  existingTargetPublicId?: string | undefined
): PlannedItem {
  return { entityKind, sourceEntityType, sourceLegacyId, action, reasonCode, before, after, existingTargetPublicId };
}

function itemDeUsuario(
  user: HelpdeskUserRecord,
  entityKind: PlannedEntityKind,
  action: PlannedAction,
  reasonCode: string,
  before: SnapshotFields | undefined,
  after: SnapshotFields | undefined,
  existingTargetPublicId?: string | undefined
): PlannedItem {
  return item(
    entityKind,
    WIZARD_SOURCE_USER_ENTITY,
    user.id,
    action,
    reasonCode,
    before,
    after,
    existingTargetPublicId
  );
}

function snapshotOrganizacao(
  input: PlanInput,
  organizationPublicId: string | null,
  resolution: string
): SnapshotFields {
  return {
    organization_public_id: organizationPublicId,
    type: WIZARD_ORGANIZATION_TYPE_COMPANY,
    legal_name: input.client.name,
    status: "ACTIVE",
    source_client_id: input.client.id,
    source_client_name: input.client.name,
    source_client_active: input.client.active,
    resolution
  };
}

function snapshotReferenciaOrganizacao(clientId: number, organizationPublicId: string | null): SnapshotFields {
  return {
    system_code: WIZARD_SOURCE_SYSTEM,
    entity_type: WIZARD_SOURCE_CLIENT_ENTITY,
    legacy_id: clientId,
    organization_public_id: organizationPublicId,
    status: "ACTIVE"
  };
}

function snapshotRelacao(
  input: PlanInput,
  parentPublicId: string,
  parentLegalName: string | null,
  filha: { readonly publicId: string; readonly legalName: string } | undefined
): SnapshotFields {
  return {
    parent_organization_public_id: parentPublicId,
    parent_legal_name: parentLegalName,
    child_organization_public_id: filha?.publicId ?? null,
    child_legal_name: filha?.legalName ?? input.client.name,
    source_client_id: input.client.id
  };
}

function snapshotIdentidade(user: HelpdeskUserRecord, emailNormalizado: string): SnapshotFields {
  return {
    source_legacy_id: user.id,
    full_name: user.name,
    email: user.email,
    email_normalized: emailNormalizado,
    source_role: user.role,
    source_active: user.active
  };
}

function snapshotReferenciaIdentidade(user: HelpdeskUserRecord): SnapshotFields {
  return {
    system_code: WIZARD_SOURCE_SYSTEM,
    entity_type: WIZARD_SOURCE_USER_ENTITY,
    legacy_id: user.id,
    match_method: "CREATED_FROM_SOURCE",
    status: "ACTIVE"
  };
}

/**
 * O destino da membership sai do VÍNCULO, não da tela.
 *
 * Vínculo de empresa aponta para a empresa, com escopo
 * `ORGANIZATION_ONLY`. Vínculo de grupo aponta para o grupo, com
 * `ORGANIZATION_AND_DESCENDANTS`. `organization_public_id` pode ser
 * `null` no dry-run de uma empresa que ainda não existe — e é
 * deliberado: o `publicId` real só nasce na transação do apply, e
 * inventar um aqui faria o snapshot afirmar um identificador que nunca
 * existiu.
 */
function snapshotMembership(
  user: HelpdeskUserRecord,
  linkKind: SourceOrganizationLinkKind,
  input: PlanInput,
  organizacao: OrganizationPlan
): SnapshotFields {
  const grupo = input.target.businessGroup;
  const alvoPublicId =
    linkKind === "BUSINESS_GROUP"
      ? (grupo?.publicId ?? null)
      : (organizacao.existingOrganizationPublicId ?? null);
  const alvoNome =
    linkKind === "BUSINESS_GROUP"
      ? (grupo?.organization?.legalName ?? null)
      : (input.target.resolvedOrganization.organization?.legalName ?? input.client.name);

  return {
    organization_public_id: alvoPublicId,
    organization_legal_name: alvoNome,
    profile: WIZARD_MEMBERSHIP_PROFILE,
    scope: membershipScopeFor(linkKind),
    status: "ACTIVE",
    link_kind: linkKind === "BUSINESS_GROUP" ? WIZARD_ORGANIZATION_TYPE_BUSINESS_GROUP : WIZARD_ORGANIZATION_TYPE_COMPANY,
    source_client_id: user.clientId,
    source_client_name: input.client.name
  };
}

function snapshotAcesso(input: PlanInput): SnapshotFields {
  return {
    application_code: input.target.application.code,
    application_public_id: input.target.application.publicId,
    access_profile: WIZARD_ACCESS_PROFILE,
    status: "GRANTED"
  };
}

/** Códigos usados pela UI para agrupar — exportado para não ser recopiado. */
export const WIZARD_APPLICATION_CODE_FOR_ACCESS = WIZARD_APPLICATION_CODE;
