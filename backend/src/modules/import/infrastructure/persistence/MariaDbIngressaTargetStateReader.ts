import type { Queryable } from "../../../../shared/database/Queryable.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";
import type {
  IngressaTargetState,
  TargetApplication,
  TargetApplicationAccessSummary,
  TargetExternalReferenceSummary,
  TargetIdentitySummary,
  TargetMembershipSummary,
  TargetOrganization
} from "../../domain/pilot/IngressaTargetState.js";
import { PILOT_SOURCE_ENTITY, PILOT_SOURCE_SYSTEM } from "../../domain/pilot/HelpdeskPilotScope.js";

export class PilotOrganizationNotFoundError extends DomainError {
  public readonly code = "IMPORT_PILOT_ORGANIZATION_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string, encontradas: number) {
    super(
      `organização de destino ${publicId} não resolvida: ${encontradas} linha(s) encontrada(s). ` +
        "O piloto exige exatamente uma."
    );
  }
}

export class PilotOrganizationNotEligibleError extends DomainError {
  public readonly code = "IMPORT_PILOT_ORGANIZATION_NOT_ELIGIBLE";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string, type: string, status: string) {
    super(
      `organização de destino ${publicId} não é elegível: type=${type}, status=${status}. ` +
        "O piloto exige COMPANY ACTIVE."
    );
  }
}

export class PilotApplicationNotResolvedError extends DomainError {
  public readonly code = "IMPORT_PILOT_APPLICATION_NOT_RESOLVED";
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

interface ExternalReferenceRow {
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

/**
 * Leitor do estado de DESTINO — somente SELECT.
 *
 * A resolução da organização é o ponto mais sensível: o `publicId` da
 * Bosque NUNCA é constante no código. Ele é procurado pela razão social
 * e só é aceito se houver **exatamente uma** COMPANY ACTIVE com aquele
 * nome. Duas candidatas, zero candidatas ou uma INACTIVE derrubam a
 * execução antes de qualquer decisão — um piloto que aponta para a
 * empresa errada concede acesso à empresa errada.
 */
export class MariaDbIngressaTargetStateReader {
  public constructor(private readonly connection: Queryable) {}

  public async read(params: {
    readonly targetOrganizationPublicId: string;
    readonly applicationCode: string;
    readonly sourceLegacyIds: readonly number[];
    readonly emailsNormalized: readonly string[];
  }): Promise<IngressaTargetState> {
    const organization = await this.resolveOrganization(params.targetOrganizationPublicId);
    const application = await this.resolveApplication(params.applicationCode);

    const externalReferences = await this.readExternalReferences(params.sourceLegacyIds);
    const identityPublicIds = [...externalReferences.values()].map((ref) => ref.identityPublicId);

    const identitiesByEmail = await this.readIdentitiesByEmail(params.emailsNormalized);
    const identitiesByPublicId = await this.readIdentitiesByPublicId(identityPublicIds);
    const memberships = await this.readMemberships(identityPublicIds, organization.publicId);
    const accesses = await this.readApplicationAccesses(identityPublicIds, application.publicId);
    const counts = await this.readCounts();

    return {
      organization,
      application,
      externalReferencesByLegacyId: externalReferences,
      identitiesByEmailNormalized: identitiesByEmail,
      identitiesByPublicId,
      membershipsByIdentityPublicId: memberships,
      applicationAccessesByIdentityPublicId: accesses,
      counts
    };
  }

  /**
   * Resolve a organização de destino pelo `publicId` afirmado pelo
   * operador.
   *
   * A consulta NÃO filtra por `type`/`status`: ela busca a linha e
   * depois verifica os dois. Filtrar no WHERE devolveria "não
   * encontrada" para uma organização que existe mas está INACTIVE — e o
   * operador iria procurar erro de digitação no UUID em vez de ver o
   * problema real. Também não filtra por nome: nome é observado para o
   * relatório, nunca usado como chave.
   */
  private async resolveOrganization(publicId: string): Promise<TargetOrganization> {
    const rows = await this.select<OrganizationRow>(
      `SELECT public_id, legal_name, type, status FROM organizations WHERE public_id = ?`,
      [publicId]
    );
    if (rows.length !== 1) {
      throw new PilotOrganizationNotFoundError(publicId, rows.length);
    }
    const row = rows[0] as OrganizationRow;
    if (row.type !== "COMPANY" || row.status !== "ACTIVE") {
      throw new PilotOrganizationNotEligibleError(publicId, row.type, row.status);
    }
    return {
      publicId: row.public_id,
      legalName: row.legal_name,
      type: row.type,
      status: row.status
    };
  }

  /**
   * Estado de UMA identidade — usado para validar o aprovador do apply
   * antes de qualquer escrita. Somente leitura.
   */
  public async findIdentityByPublicId(publicId: string): Promise<TargetIdentitySummary | undefined> {
    const rows = await this.select<IdentityRow>(
      `SELECT public_id, full_name, email_normalized, status FROM identities WHERE public_id = ?`,
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
      throw new PilotApplicationNotResolvedError(code);
    }
    return { publicId: row.public_id, code: row.code, status: row.status };
  }

  private async readExternalReferences(
    legacyIds: readonly number[]
  ): Promise<ReadonlyMap<string, TargetExternalReferenceSummary>> {
    const mapa = new Map<string, TargetExternalReferenceSummary>();
    if (legacyIds.length === 0) {
      return mapa;
    }
    const placeholders = legacyIds.map(() => "?").join(", ");
    const rows = await this.select<ExternalReferenceRow>(
      `SELECT public_id, identity_public_id, legacy_id, match_method, status
         FROM identity_external_references
        WHERE system_code = ? AND entity_type = ? AND status = 'ACTIVE'
          AND legacy_id IN (${placeholders})`,
      [PILOT_SOURCE_SYSTEM, PILOT_SOURCE_ENTITY, ...legacyIds]
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
    organizationPublicId: string
  ): Promise<ReadonlyMap<string, TargetMembershipSummary>> {
    const mapa = new Map<string, TargetMembershipSummary>();
    if (identityPublicIds.length === 0) {
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
   * `counts_before` — só números agregados, nunca dado pessoal. É o que
   * permite comparar o antes e o depois de um lote sem reabrir a trilha.
   */
  private async readCounts(): Promise<Readonly<Record<string, number>>> {
    const contagens: Record<string, number> = {};
    const alvos: readonly (readonly [string, string])[] = [
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

  private async select<T>(sql: string, params: readonly unknown[]): Promise<readonly T[]> {
    const [rows] = await this.connection.execute(sql, params);
    return rows as unknown as readonly T[];
  }
}

function toIdentity(row: IdentityRow): TargetIdentitySummary {
  return {
    publicId: row.public_id,
    fullName: row.full_name,
    emailNormalized: row.email_normalized,
    status: row.status
  };
}
