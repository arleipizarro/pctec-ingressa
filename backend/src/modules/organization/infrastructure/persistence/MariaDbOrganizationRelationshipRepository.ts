import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { OrganizationRelationshipRepository } from "../../domain/OrganizationRelationshipRepository.js";
import type { PublicId } from "../../domain/value-objects/PublicId.js";
import {
  OrganizationRelationship,
  type OrganizationRelationshipPersistedState
} from "../../domain/OrganizationRelationship.js";

type OrganizationRelationshipRow = Record<string, unknown>;

function readString(row: OrganizationRelationshipRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Coluna "${column}" ausente ou não é string na linha de organization_relationships.`);
  }
  return value;
}

function readNumber(row: OrganizationRelationshipRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é número na linha de organization_relationships.`);
}

function readDate(row: OrganizationRelationshipRow, column: string): Date {
  const value = row[column];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  throw new Error(`Coluna "${column}" ausente ou não é data na linha de organization_relationships.`);
}

function mapRowToPersistedState(row: OrganizationRelationshipRow): OrganizationRelationshipPersistedState {
  return {
    internalId: readNumber(row, "id"),
    publicId: readString(row, "public_id"),
    parentOrganizationPublicId: readString(row, "parent_organization_public_id"),
    childOrganizationPublicId: readString(row, "child_organization_public_id"),
    createdAt: readDate(row, "created_at")
  };
}

/**
 * Implementação MariaDB de OrganizationRelationshipRepository, conforme
 * `0011_create_organization_relationships.up.sql`. Todas as queries usam
 * parâmetros preparados (`?`), nunca concatenação de SQL com entrada.
 */
export class MariaDbOrganizationRelationshipRepository implements OrganizationRelationshipRepository {
  public constructor(private readonly connection: Queryable) {}

  public async existsByChildOrganizationPublicId(childOrganizationPublicId: PublicId): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1 FROM organization_relationships WHERE child_organization_public_id = ? LIMIT 1`,
      [childOrganizationPublicId.toString()]
    );
    return (rows as OrganizationRelationshipRow[]).length > 0;
  }

  public async findChildrenByParentPublicId(parentPublicId: PublicId): Promise<OrganizationRelationship[]> {
    const [rows] = await this.connection.execute(
      `SELECT id, public_id, parent_organization_public_id, child_organization_public_id, created_at
         FROM organization_relationships
        WHERE parent_organization_public_id = ?
        ORDER BY created_at ASC`,
      [parentPublicId.toString()]
    );
    return (rows as OrganizationRelationshipRow[]).map((row) =>
      OrganizationRelationship.reconstitute(mapRowToPersistedState(row))
    );
  }

  public async insert(relationship: OrganizationRelationship): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO organization_relationships
         (public_id, parent_organization_public_id, child_organization_public_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [
        relationship.getPublicId().toString(),
        relationship.getParentOrganizationPublicId().toString(),
        relationship.getChildOrganizationPublicId().toString(),
        relationship.getCreatedAt()
      ]
    );
    const insertResult = result as { insertId: number };
    relationship.assignInternalIdFromPersistence(insertResult.insertId);
  }
}
