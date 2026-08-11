import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { OrganizationRelationshipRepository } from "../../domain/OrganizationRelationshipRepository.js";
import type { PublicId } from "../../domain/value-objects/PublicId.js";
import { OrganizationRelationship } from "../../domain/OrganizationRelationship.js";

type OrganizationRelationshipRow = Record<string, unknown>;

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
