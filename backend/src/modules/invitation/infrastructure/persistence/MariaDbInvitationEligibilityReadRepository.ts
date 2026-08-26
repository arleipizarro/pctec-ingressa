import type { Queryable } from "../../../../shared/database/Queryable.js";
import type {
  InvitationCandidate,
  InvitationEligibilityReadRepository
} from "../../application/CreateIdentityInvitationService.js";

function comoBooleano(valor: unknown): boolean {
  return valor === 1 || valor === true || valor === "1";
}

/**
 * Projeção de elegibilidade — uma consulta, cinco perguntas.
 *
 * As condições de elegibilidade ("tem alguma referência externa?",
 * "alguma delas está ACTIVE?", "já tem credencial?", "tem algum acesso
 * de aplicação?") são resolvidas como `EXISTS` no
 * banco, não como N consultas por identidade em laço: a tela de
 * convites opera sobre seleção múltipla, e um laço aqui viraria dezenas
 * de round-trips por clique.
 *
 * `IN (...)` com placeholders gerados a partir do TAMANHO da lista —
 * nunca dos valores. Nenhum dado de entrada é concatenado no SQL.
 */
export class MariaDbInvitationEligibilityReadRepository implements InvitationEligibilityReadRepository {
  public constructor(private readonly connection: Queryable) {}

  public async loadCandidates(identityPublicIds: readonly string[]): Promise<readonly InvitationCandidate[]> {
    if (identityPublicIds.length === 0) {
      return [];
    }
    const placeholders = identityPublicIds.map(() => "?").join(", ");
    const [rows] = await this.connection.execute(
      `SELECT i.public_id,
              i.full_name,
              i.email,
              i.status,
              i.login_enabled,
              EXISTS (SELECT 1
                        FROM identity_external_references r
                       WHERE r.identity_public_id = i.public_id)        AS has_external_reference,
              EXISTS (SELECT 1
                        FROM identity_external_references r
                       WHERE r.identity_public_id = i.public_id
                         AND r.status = 'ACTIVE')                       AS has_active_external_reference,
              EXISTS (SELECT 1
                        FROM credentials c
                       WHERE c.identity_public_id = i.public_id
                         AND c.type = 'LOCAL_PASSWORD')                 AS has_credential,
              EXISTS (SELECT 1
                        FROM application_accesses aa
                        JOIN applications a ON a.public_id = aa.application_public_id
                       WHERE aa.identity_public_id = i.public_id
                         AND aa.status = 'GRANTED'
                         AND a.status = 'ACTIVE')                       AS has_application_access
         FROM identities i
        WHERE i.public_id IN (${placeholders})`,
      identityPublicIds
    );

    return (rows as Array<Record<string, unknown>>).map((row) => ({
      identityPublicId: String(row["public_id"]),
      fullName: String(row["full_name"]),
      email: String(row["email"]),
      status: String(row["status"]),
      loginEnabled: comoBooleano(row["login_enabled"]),
      hasExternalReference: comoBooleano(row["has_external_reference"]),
      hasActiveExternalReference: comoBooleano(row["has_active_external_reference"]),
      hasCredential: comoBooleano(row["has_credential"]),
      hasApplicationAccess: comoBooleano(row["has_application_access"])
    }));
  }
}
