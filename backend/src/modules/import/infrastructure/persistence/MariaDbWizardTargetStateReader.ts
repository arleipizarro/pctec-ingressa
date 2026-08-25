import type { Queryable } from "../../../../shared/database/Queryable.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";
import type {
  ResolvedTargetBusinessGroup,
  ResolvedTargetOrganization,
  TargetApplication,
  TargetApplicationAccessSummary,
  TargetExternalReferenceSummary,
  TargetIdentitySummary,
  TargetMembershipSummary,
  TargetOrganization,
  TargetOrganizationExternalReferenceSummary,
  TargetOrganizationRelationshipSummary,
  WizardTargetState
} from "../../domain/wizard/WizardTargetState.js";
import type {
  CatalogCompanyLink,
  CatalogIdentityLink,
  WizardCatalogTargetReader
} from "../../application/GetHelpdeskCatalogService.js";
import {
  WIZARD_ORGANIZATION_TYPE_BUSINESS_GROUP,
  WIZARD_ORGANIZATION_TYPE_COMPANY,
  WIZARD_SOURCE_CLIENT_ENTITY,
  WIZARD_SOURCE_SYSTEM,
  WIZARD_SOURCE_USER_ENTITY
} from "../../domain/wizard/HelpdeskImportScope.js";

export class WizardApplicationNotResolvedError extends DomainError {
  public readonly code = "IMPORT_WIZARD_APPLICATION_NOT_RESOLVED";
  public readonly classification = "VALIDATION" as const;

  constructor(code: string) {
    super(`aplicação "${code}" não encontrada ou não está ACTIVE no Ingressa.`);
  }
}

interface OrganizationRow {
  readonly public_id: string;
  readonly legal_name: string;
  readonly type: string;
  readonly status: string;
}

interface OrganizationExternalReferenceRow {
  readonly public_id: string;
  readonly organization_public_id: string;
  readonly legacy_id: number | string;
  readonly status: string;
}

interface RelationshipRow {
  readonly public_id: string;
  readonly parent_organization_public_id: string;
  readonly child_organization_public_id: string;
}

interface ApplicationRow {
  readonly public_id: string;
  readonly code: string;
  readonly status: string;
}

interface IdentityRow {
  readonly public_id: string;
  readonly full_name: string;
  readonly email_normalized: string;
  readonly status: string;
}

interface IdentityExternalReferenceRow {
  readonly public_id: string;
  readonly identity_public_id: string;
  readonly legacy_id: number | string;
  readonly match_method: string;
  readonly status: string;
}

interface MembershipRow {
  readonly public_id: string;
  readonly identity_public_id: string;
  readonly organization_public_id: string;
  readonly profile: string;
  readonly scope: string;
  readonly status: string;
}

interface ApplicationAccessRow {
  readonly public_id: string;
  readonly identity_public_id: string;
  readonly application_public_id: string;
  readonly access_profile: string;
  readonly status: string;
}

interface CountRow {
  readonly total: number | string;
}

export interface WizardTargetStateQuery {
  readonly sourceClientId: number;
  readonly assertedOrganizationPublicId: string | null;
  readonly assertedBusinessGroupPublicId: string | null;
  readonly applicationCode: string;
  readonly sourceLegacyIds: readonly number[];
  readonly emailsNormalized: readonly string[];
}

/**
 * Leitor do estado de DESTINO do assistente — somente SELECT.
 *
 * A diferença que justifica um leitor novo em vez de um parâmetro a
 * mais no do piloto está na resolução da organização. O piloto exigia
 * que a empresa existisse e lançava quando não existia; aqui, "não
 * existe" é uma resposta legítima — significa CREATE — e por isso a
 * resolução devolve um resultado descritivo em vez de lançar.
 *
 * O que este leitor NUNCA faz, e é a regra mais importante dele:
 * procurar organização por NOME. `clients(id, name, active)` é tudo que
 * o grant read-only da fonte projeta — não há CNPJ vindo da origem para
 * gerar sequer um candidato — e casar por razão social transformaria um
 * `UPDATE clients SET name` do Helpdesk em mudança de quem tem acesso a
 * quê. A única resolução automática é por `OrganizationExternalReference`
 * ativa; a única alternativa é o ADMIN afirmar o `publicId`.
 */
export class MariaDbWizardTargetStateReader implements WizardCatalogTargetReader {
  public constructor(private readonly connection: Queryable) {}

  public async read(query: WizardTargetStateQuery): Promise<WizardTargetState> {
    const resolvedOrganization = await this.resolveOrganization(
      query.sourceClientId,
      query.assertedOrganizationPublicId
    );
    const application = await this.resolveApplication(query.applicationCode);

    const businessGroup =
      query.assertedBusinessGroupPublicId === null
        ? undefined
        : await this.resolveBusinessGroup(
            query.assertedBusinessGroupPublicId,
            resolvedOrganization.organization?.publicId
          );

    const externalReferences = await this.readIdentityExternalReferences(query.sourceLegacyIds);
    const identityPublicIds = [...externalReferences.values()].map((ref) => ref.identityPublicId);

    const identitiesByEmail = await this.readIdentitiesByEmail(query.emailsNormalized);
    const identitiesByPublicId = await this.readIdentitiesByPublicId(identityPublicIds);
    const memberships = await this.readMemberships(identityPublicIds, resolvedOrganization.organization?.publicId);
    const groupMemberships = await this.readMemberships(identityPublicIds, businessGroup?.publicId);
    const accesses = await this.readApplicationAccesses(identityPublicIds, application.publicId);
    const counts = await this.readCounts();

    return {
      resolvedOrganization,
      businessGroup,
      application,
      externalReferencesByLegacyId: externalReferences,
      identitiesByEmailNormalized: identitiesByEmail,
      identitiesByPublicId,
      membershipsByIdentityPublicId: memberships,
      groupMembershipsByIdentityPublicId: groupMemberships,
      applicationAccessesByIdentityPublicId: accesses,
      counts
    };
  }

  /**
   * Resolve o destino da empresa de origem.
   *
   * Ordem deliberada: a referência externa vence a afirmação do
   * operador. Se alguém já amarrou `clients:75` a uma Organization, um
   * `publicId` diferente digitado na tela não corrige nem substitui
   * aquele vínculo — vira `assertionConflict`, que o planner
   * transforma em CONFLICT e bloqueia o lote. Trocar a empresa de
   * destino de um cliente já importado é decisão de quem concedeu.
   */
  public async resolveOrganization(
    sourceClientId: number,
    assertedPublicId: string | null
  ): Promise<ResolvedTargetOrganization> {
    const referencia = await this.findOrganizationExternalReference(sourceClientId);

    if (referencia !== undefined) {
      const organizacao = await this.findOrganization(referencia.organizationPublicId);
      const conflito =
        assertedPublicId !== null && assertedPublicId !== referencia.organizationPublicId
          ? `referência externa ativa já aponta para ${referencia.organizationPublicId}`
          : undefined;
      return {
        kind: "EXTERNAL_REFERENCE",
        organization: elegivelComoEmpresa(organizacao) ? organizacao : undefined,
        externalReference: referencia,
        assertionConflict: conflito
      };
    }

    if (assertedPublicId !== null) {
      const organizacao = await this.findOrganization(assertedPublicId);
      return {
        kind: "OPERATOR_ASSERTED",
        organization: elegivelComoEmpresa(organizacao) ? organizacao : undefined,
        externalReference: undefined,
        assertionConflict: undefined
      };
    }

    return {
      kind: "ABSENT",
      organization: undefined,
      externalReference: undefined,
      assertionConflict: undefined
    };
  }

  private async resolveBusinessGroup(
    publicId: string,
    childOrganizationPublicId: string | undefined
  ): Promise<ResolvedTargetBusinessGroup> {
    const organizacao = await this.findOrganization(publicId);
    const motivo =
      organizacao === undefined
        ? "organização não encontrada"
        : organizacao.type !== WIZARD_ORGANIZATION_TYPE_BUSINESS_GROUP
          ? `type=${organizacao.type} — esperado ${WIZARD_ORGANIZATION_TYPE_BUSINESS_GROUP}`
          : organizacao.status !== "ACTIVE"
            ? `status=${organizacao.status}`
            : undefined;

    const relacao =
      childOrganizationPublicId === undefined
        ? undefined
        : await this.findRelationshipByChild(childOrganizationPublicId);

    return {
      publicId,
      organization: organizacao,
      eligible: motivo === undefined,
      ineligibleReason: motivo,
      existingRelationship: relacao
    };
  }

  private async findOrganization(publicId: string): Promise<TargetOrganization | undefined> {
    const rows = await this.select<OrganizationRow>(
      `SELECT public_id, legal_name, type, status FROM organizations WHERE public_id = ? LIMIT 1`,
      [publicId]
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : { publicId: row.public_id, legalName: row.legal_name, type: row.type, status: row.status };
  }

  private async findOrganizationExternalReference(
    sourceClientId: number
  ): Promise<TargetOrganizationExternalReferenceSummary | undefined> {
    const rows = await this.select<OrganizationExternalReferenceRow>(
      `SELECT public_id, organization_public_id, legacy_id, status
         FROM organization_external_references
        WHERE system_code = ? AND entity_type = ? AND legacy_id = ? AND status = 'ACTIVE'
        LIMIT 1`,
      [WIZARD_SOURCE_SYSTEM, WIZARD_SOURCE_CLIENT_ENTITY, sourceClientId]
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          publicId: row.public_id,
          organizationPublicId: row.organization_public_id,
          legacyId: String(row.legacy_id),
          status: row.status
        };
  }

  private async findRelationshipByChild(
    childOrganizationPublicId: string
  ): Promise<TargetOrganizationRelationshipSummary | undefined> {
    const rows = await this.select<RelationshipRow>(
      `SELECT public_id, parent_organization_public_id, child_organization_public_id
         FROM organization_relationships
        WHERE child_organization_public_id = ?
        LIMIT 1`,
      [childOrganizationPublicId]
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          publicId: row.public_id,
          parentOrganizationPublicId: row.parent_organization_public_id,
          childOrganizationPublicId: row.child_organization_public_id
        };
  }

  /**
   * Estado de UMA identidade — usado para validar o aprovador do apply
   * antes de qualquer escrita. Somente leitura.
   */
  public async findIdentityByPublicId(publicId: string): Promise<TargetIdentitySummary | undefined> {
    const rows = await this.select<IdentityRow>(
      `SELECT public_id, full_name, email_normalized, status FROM identities WHERE public_id = ? LIMIT 1`,
      [publicId]
    );
    const row = rows[0];
    return row === undefined ? undefined : toIdentity(row);
  }

  private async resolveApplication(code: string): Promise<TargetApplication> {
    const rows = await this.select<ApplicationRow>(
      `SELECT public_id, code, status FROM applications WHERE code = ? AND status = 'ACTIVE'`,
      [code]
    );
    const row = rows[0];
    if (rows.length !== 1 || row === undefined) {
      throw new WizardApplicationNotResolvedError(code);
    }
    return { publicId: row.public_id, code: row.code, status: row.status };
  }

  private async readIdentityExternalReferences(
    legacyIds: readonly number[]
  ): Promise<ReadonlyMap<string, TargetExternalReferenceSummary>> {
    const mapa = new Map<string, TargetExternalReferenceSummary>();
    if (legacyIds.length === 0) {
      return mapa;
    }
    const placeholders = legacyIds.map(() => "?").join(", ");
    const rows = await this.select<IdentityExternalReferenceRow>(
      `SELECT public_id, identity_public_id, legacy_id, match_method, status
         FROM identity_external_references
        WHERE system_code = ? AND entity_type = ? AND status = 'ACTIVE'
          AND legacy_id IN (${placeholders})`,
      [WIZARD_SOURCE_SYSTEM, WIZARD_SOURCE_USER_ENTITY, ...legacyIds]
    );
    for (const row of rows) {
      mapa.set(String(row.legacy_id), {
        publicId: row.public_id,
        identityPublicId: row.identity_public_id,
        legacyId: String(row.legacy_id),
        matchMethod: row.match_method,
        status: row.status
      });
    }
    return mapa;
  }

  private async readIdentitiesByEmail(
    emails: readonly string[]
  ): Promise<ReadonlyMap<string, TargetIdentitySummary>> {
    const mapa = new Map<string, TargetIdentitySummary>();
    if (emails.length === 0) {
      return mapa;
    }
    const placeholders = emails.map(() => "?").join(", ");
    const rows = await this.select<IdentityRow>(
      `SELECT public_id, full_name, email_normalized, status
         FROM identities
        WHERE email_normalized IN (${placeholders}) AND status <> 'DELETED'`,
      [...emails]
    );
    for (const row of rows) {
      mapa.set(row.email_normalized, toIdentity(row));
    }
    return mapa;
  }

  private async readIdentitiesByPublicId(
    publicIds: readonly string[]
  ): Promise<ReadonlyMap<string, TargetIdentitySummary>> {
    const mapa = new Map<string, TargetIdentitySummary>();
    if (publicIds.length === 0) {
      return mapa;
    }
    const placeholders = publicIds.map(() => "?").join(", ");
    const rows = await this.select<IdentityRow>(
      `SELECT public_id, full_name, email_normalized, status
         FROM identities
        WHERE public_id IN (${placeholders})`,
      [...publicIds]
    );
    for (const row of rows) {
      mapa.set(row.public_id, toIdentity(row));
    }
    return mapa;
  }

  private async readMemberships(
    identityPublicIds: readonly string[],
    organizationPublicId: string | undefined
  ): Promise<ReadonlyMap<string, TargetMembershipSummary>> {
    const mapa = new Map<string, TargetMembershipSummary>();
    if (identityPublicIds.length === 0 || organizationPublicId === undefined) {
      return mapa;
    }
    const placeholders = identityPublicIds.map(() => "?").join(", ");
    const rows = await this.select<MembershipRow>(
      `SELECT public_id, identity_public_id, organization_public_id, profile, scope, status
         FROM memberships
        WHERE organization_public_id = ? AND status = 'ACTIVE'
          AND identity_public_id IN (${placeholders})`,
      [organizationPublicId, ...identityPublicIds]
    );
    for (const row of rows) {
      mapa.set(row.identity_public_id, {
        publicId: row.public_id,
        identityPublicId: row.identity_public_id,
        organizationPublicId: row.organization_public_id,
        profile: row.profile,
        scope: row.scope,
        status: row.status
      });
    }
    return mapa;
  }

  private async readApplicationAccesses(
    identityPublicIds: readonly string[],
    applicationPublicId: string
  ): Promise<ReadonlyMap<string, TargetApplicationAccessSummary>> {
    const mapa = new Map<string, TargetApplicationAccessSummary>();
    if (identityPublicIds.length === 0) {
      return mapa;
    }
    const placeholders = identityPublicIds.map(() => "?").join(", ");
    const rows = await this.select<ApplicationAccessRow>(
      `SELECT public_id, identity_public_id, application_public_id, access_profile, status
         FROM application_accesses
        WHERE application_public_id = ? AND status = 'GRANTED'
          AND identity_public_id IN (${placeholders})`,
      [applicationPublicId, ...identityPublicIds]
    );
    for (const row of rows) {
      mapa.set(row.identity_public_id, {
        publicId: row.public_id,
        identityPublicId: row.identity_public_id,
        applicationPublicId: row.application_public_id,
        accessProfile: row.access_profile,
        status: row.status
      });
    }
    return mapa;
  }

  /**
   * `counts_before` — só números agregados, nunca dado pessoal.
   *
   * As três contagens de organização entram porque o assistente, ao
   * contrário do piloto, escreve organização: um antes/depois que não
   * conta o que o lote cria não serve para conferir o que o lote fez.
   */
  public async readCounts(): Promise<Readonly<Record<string, number>>> {
    const contagens: Record<string, number> = {};
    const alvos: readonly (readonly [string, string])[] = [
      ["organizations", "SELECT COUNT(*) AS total FROM organizations WHERE status = 'ACTIVE'"],
      ["organizationRelationships", "SELECT COUNT(*) AS total FROM organization_relationships"],
      [
        "organizationExternalReferences",
        "SELECT COUNT(*) AS total FROM organization_external_references WHERE status = 'ACTIVE'"
      ],
      ["identities", "SELECT COUNT(*) AS total FROM identities WHERE status <> 'DELETED'"],
      [
        "identityExternalReferences",
        "SELECT COUNT(*) AS total FROM identity_external_references WHERE status = 'ACTIVE'"
      ],
      ["memberships", "SELECT COUNT(*) AS total FROM memberships WHERE status = 'ACTIVE'"],
      ["applicationAccesses", "SELECT COUNT(*) AS total FROM application_accesses WHERE status = 'GRANTED'"]
    ];
    for (const [chave, sql] of alvos) {
      const rows = await this.select<CountRow>(sql, []);
      contagens[chave] = Number(rows[0]?.total ?? 0);
    }
    return contagens;
  }

  /**
   * "Quais destas empresas da origem já viraram Organization?" — uma
   * consulta para a página inteira do catálogo, não uma por linha.
   *
   * O JOIN é pela referência externa ATIVA, nunca pelo nome. Uma
   * empresa cuja Organization foi INACTIVE continua aparecendo
   * vinculada, com o status real: esconder o vínculo faria a tela
   * sugerir criar uma segunda empresa para o mesmo `clients.id`.
   */
  public async findOrganizationsBySourceClientIds(
    ids: readonly number[]
  ): Promise<ReadonlyMap<number, CatalogCompanyLink>> {
    const mapa = new Map<number, CatalogCompanyLink>();
    if (ids.length === 0) {
      return mapa;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await this.select<OrganizationExternalReferenceRow & OrganizationRow>(
      `SELECT r.legacy_id, o.public_id, o.legal_name, o.type, o.status
         FROM organization_external_references r
         JOIN organizations o ON o.public_id = r.organization_public_id
        WHERE r.system_code = ? AND r.entity_type = ? AND r.status = 'ACTIVE'
          AND r.legacy_id IN (${placeholders})`,
      [WIZARD_SOURCE_SYSTEM, WIZARD_SOURCE_CLIENT_ENTITY, ...ids]
    );
    for (const row of rows) {
      mapa.set(Number(row.legacy_id), {
        organizationPublicId: row.public_id,
        legalName: row.legal_name,
        type: row.type,
        status: row.status
      });
    }
    return mapa;
  }

  /** Mesma pergunta, do lado das pessoas: "quem já foi importado?". */
  public async findIdentitiesBySourceUserIds(
    ids: readonly number[]
  ): Promise<ReadonlyMap<number, CatalogIdentityLink>> {
    const mapa = new Map<number, CatalogIdentityLink>();
    if (ids.length === 0) {
      return mapa;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await this.select<IdentityExternalReferenceRow & IdentityRow>(
      `SELECT r.legacy_id, i.public_id, i.full_name, i.status
         FROM identity_external_references r
         JOIN identities i ON i.public_id = r.identity_public_id
        WHERE r.system_code = ? AND r.entity_type = ? AND r.status = 'ACTIVE'
          AND r.legacy_id IN (${placeholders})`,
      [WIZARD_SOURCE_SYSTEM, WIZARD_SOURCE_USER_ENTITY, ...ids]
    );
    for (const row of rows) {
      mapa.set(Number(row.legacy_id), {
        identityPublicId: row.public_id,
        fullName: row.full_name,
        status: row.status
      });
    }
    return mapa;
  }

  private async select<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    const [rows] = await this.connection.execute(sql, params);
    return rows as unknown as readonly T[];
  }
}

/**
 * Empresa de destino precisa ser COMPANY e ACTIVE.
 *
 * Devolver `undefined` em vez de lançar é o que permite ao planner
 * transformar "apontaram para um BUSINESS_GROUP" em CONFLICT com motivo
 * registrado no lote, em vez de um erro que apaga o resto da revisão.
 */
function elegivelComoEmpresa(organizacao: TargetOrganization | undefined): boolean {
  return (
    organizacao !== undefined &&
    organizacao.type === WIZARD_ORGANIZATION_TYPE_COMPANY &&
    organizacao.status === "ACTIVE"
  );
}

function toIdentity(row: IdentityRow): TargetIdentitySummary {
  return {
    publicId: row.public_id,
    fullName: row.full_name,
    emailNormalized: row.email_normalized,
    status: row.status
  };
}
