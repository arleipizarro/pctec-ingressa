import type { Queryable } from "../../../../shared/database/Queryable.js";
import type {
  GrantedApplicationReadRepository,
  GrantedApplicationRow
} from "../../application/GetMyApplicationsService.js";

/**
 * Projeção de leitura do launcher — conforme `0005_create_applications`
 * e `0006_create_application_accesses`.
 *
 * As duas condições que definem "tenho acesso" (`aa.status = 'GRANTED'`
 * e `a.status = 'ACTIVE'`) ficam no `WHERE`, junto com a identidade.
 * SQL sempre parametrizado.
 */
export class MariaDbGrantedApplicationReadRepository implements GrantedApplicationReadRepository {
  public constructor(private readonly connection: Queryable) {}

  public async listGrantedApplications(identityPublicId: string): Promise<readonly GrantedApplicationRow[]> {
    const [rows] = await this.connection.execute(
      `SELECT a.code           AS application_code,
              a.name           AS application_name,
              aa.access_profile AS access_profile
         FROM application_accesses aa
         JOIN applications a ON a.public_id = aa.application_public_id
        WHERE aa.identity_public_id = ?
          AND aa.status = 'GRANTED'
          AND a.status = 'ACTIVE'
        ORDER BY a.name`,
      [identityPublicId]
    );
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      applicationCode: String(row["application_code"]),
      applicationName: String(row["application_name"]),
      accessProfile: String(row["access_profile"])
    }));
  }
}
