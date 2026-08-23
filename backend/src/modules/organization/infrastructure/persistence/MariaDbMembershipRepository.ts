import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { MembershipRepository } from "../../domain/MembershipRepository.js";
import { Membership, type MembershipPersistedState } from "../../domain/Membership.js";
import { MembershipVersionConflictError } from "../../domain/errors/MembershipErrors.js";
import type { PublicId } from "../../domain/value-objects/PublicId.js";
import type { MembershipProfile } from "../../domain/value-objects/MembershipProfile.js";

type MembershipRow = Record<string, unknown>;

function readString(row: MembershipRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de memberships.`);
  }
  return value;
}

function readNumber(row: MembershipRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de memberships.`);
}

function readDate(row: MembershipRow, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de memberships.`);
}

function readOptionalDate(row: MembershipRow, column: string): Date | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(String(value));
}

function mapRowToPersistedState(row: MembershipRow): MembershipPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    identityPublicId: readString(row, "identity_public_id"),
    organizationPublicId: readString(row, "organization_public_id"),
    profile: readString(row, "profile"),
    scope: readString(row, "scope"),
    status: readString(row, "status"),
    startedAt: readDate(row, "started_at"),
    endedAt: readOptionalDate(row, "ended_at"),
    version: readNumber(row, "version"),
    createdAt: readDate(row, "created_at"),
    updatedAt: readDate(row, "updated_at")
  };
}

/**
 * Implementação MariaDB de MembershipRepository, conforme
 * `0012_create_memberships.up.sql`. Todas as queries usam parâmetros
 * preparados (`?`), nunca concatenação de SQL com entrada.
 */
export class MariaDbMembershipRepository implements MembershipRepository {
  public constructor(private readonly connection: Queryable) {}

  public async findByPublicId(publicId: PublicId): Promise<Membership | undefined> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, identity_public_id, organization_public_id, profile, scope,
              status, started_at, ended_at, version, created_at, updated_at
         FROM memberships
        WHERE public_id = ?
        LIMIT 1`,
      [publicId.toString()]
    );
    const rowList = rows as MembershipRow[];
    const row = rowList[0];
    return row === undefined ? undefined : Membership.reconstitute(mapRowToPersistedState(row));
  }

  public async findAllByIdentityPublicId(identityPublicId: string): Promise<Membership[]> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, identity_public_id, organization_public_id, profile, scope,
              status, started_at, ended_at, version, created_at, updated_at
         FROM memberships
        WHERE identity_public_id = ?
        ORDER BY created_at ASC`,
      [identityPublicId]
    );
    return (rows as MembershipRow[]).map((row) => Membership.reconstitute(mapRowToPersistedState(row)));
  }

  public async findActiveByIdentityPublicId(identityPublicId: string): Promise<Membership[]> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, identity_public_id, organization_public_id, profile, scope,
              status, started_at, ended_at, version, created_at, updated_at
         FROM memberships
        WHERE identity_public_id = ? AND status = 'ACTIVE'
        ORDER BY created_at ASC`,
      [identityPublicId]
    );
    return (rows as MembershipRow[]).map((row) => Membership.reconstitute(mapRowToPersistedState(row)));
  }

  public async existsByIdentityOrganizationAndProfile(
    identityPublicId: string,
    organizationPublicId: string,
    profile: MembershipProfile
  ): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1 FROM memberships
        WHERE identity_public_id = ? AND organization_public_id = ? AND profile = ?
        LIMIT 1`,
      [identityPublicId, organizationPublicId, profile.toString()]
    );
    return (rows as MembershipRow[]).length > 0;
  }

  public async insert(membership: Membership): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO memberships
         (public_id, identity_public_id, organization_public_id, profile, scope,
          status, started_at, ended_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        membership.getPublicId().toString(),
        membership.getIdentityPublicId(),
        membership.getOrganizationPublicId(),
        membership.getProfile().toString(),
        membership.getScope().toString(),
        membership.getStatus(),
        membership.getStartedAt(),
        membership.getEndedAt() ?? null,
        membership.getVersion(),
        membership.getCreatedAt(),
        membership.getUpdatedAt()
      ]
    );
    const insertResult = result as { insertId: number };
    membership.assignInternalIdFromPersistence(insertResult.insertId);
  }

  /**
   * Atualiza um Membership existente com optimistic locking — P1D.1.
   *
   * O `UPDATE` é condicionado à `version` que o chamador leu; zero linhas
   * afetadas significam alteração concorrente, e a operação falha em vez
   * de sobrescrever. Mesmo mecanismo de `MariaDbIdentityRepository.update`.
   *
   * Só os campos que uma transição de estado pode mudar são escritos —
   * `identity_public_id`, `organization_public_id`, `profile`, `scope`,
   * `started_at` e `created_at` são imutáveis por design e não aparecem
   * no SET: um `UPDATE` que os incluísse permitiria, por engano de
   * chamada, transformar um vínculo em outro.
   */
  public async update(membership: Membership, expectedVersion: number): Promise<void> {
    const [result] = await this.connection.execute(
      `UPDATE memberships
          SET status = ?,
              ended_at = ?,
              version = ?,
              updated_at = ?
        WHERE public_id = ? AND version = ?`,
      [
        membership.getStatus(),
        membership.getEndedAt() ?? null,
        membership.getVersion(),
        membership.getUpdatedAt(),
        membership.getPublicId().toString(),
        expectedVersion
      ]
    );
    const updateResult = result as { affectedRows: number };
    if (updateResult.affectedRows === 0) {
      throw new MembershipVersionConflictError(expectedVersion, membership.getVersion());
    }
  }
}
