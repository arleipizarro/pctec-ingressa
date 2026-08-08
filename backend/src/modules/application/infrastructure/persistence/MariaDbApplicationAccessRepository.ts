import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { ApplicationAccessRepository } from "../../domain/ApplicationAccessRepository.js";
import type { ApplicationAccess } from "../../domain/ApplicationAccess.js";

/**
 * Implementação MariaDB de ApplicationAccessRepository, conforme
 * `0005_create_applications_and_application_accesses.up.sql`. SQL sempre
 * parametrizado.
 */
export class MariaDbApplicationAccessRepository implements ApplicationAccessRepository {
  public constructor(private readonly connection: Queryable) {}

  public async existsGrantedByApplicationAndProfile(
    applicationPublicId: string,
    accessProfile: string
  ): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1
         FROM application_accesses
        WHERE application_public_id = ?
          AND access_profile = ?
          AND status = 'GRANTED'
        LIMIT 1`,
      [applicationPublicId, accessProfile]
    );
    return (rows as unknown[]).length > 0;
  }

  public async existsGrantedByIdentityApplicationAndProfile(
    identityPublicId: string,
    applicationPublicId: string,
    accessProfile: string
  ): Promise<boolean> {
    const [rows] = await this.connection.execute(
      `SELECT 1
         FROM application_accesses
        WHERE identity_public_id = ?
          AND application_public_id = ?
          AND access_profile = ?
          AND status = 'GRANTED'
        LIMIT 1`,
      [identityPublicId, applicationPublicId, accessProfile]
    );
    return (rows as unknown[]).length > 0;
  }

  public async insert(applicationAccess: ApplicationAccess): Promise<void> {
    const [result] = await this.connection.execute(
      `INSERT INTO application_accesses
         (public_id, identity_public_id, application_public_id, access_profile,
          status, granted_at, granted_by_identity_public_id, revoked_at,
          revoked_by_identity_public_id, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationAccess.getPublicId().toString(),
        applicationAccess.getIdentityPublicId(),
        applicationAccess.getApplicationPublicId(),
        applicationAccess.getAccessProfile().toString(),
        applicationAccess.getStatus(),
        applicationAccess.getGrantedAt(),
        applicationAccess.getGrantedByIdentityPublicId() ?? null,
        null, // revoked_at — sempre NULL na concessão inicial
        null, // revoked_by_identity_public_id — sempre NULL na concessão inicial
        applicationAccess.getVersion(),
        applicationAccess.getGrantedAt(),
        applicationAccess.getGrantedAt()
      ]
    );
    const insertResult = result as { insertId: number };
    applicationAccess.assignInternalIdFromPersistence(insertResult.insertId);
  }
}
