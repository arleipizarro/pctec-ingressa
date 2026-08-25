import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { IdentityUsageCounters } from "../../application/DiscardUnusedPendingIdentityService.js";

/**
 * Contagens de vínculo de uma Identity — somente leitura.
 *
 * Ficam fora dos repositórios de cada agregado de propósito: são cinco
 * perguntas de "existe alguma coisa apontando para esta identidade?",
 * feitas pelo descarte e por mais ninguém. Espalhá-las como método novo
 * em cinco repositórios diferentes ampliaria cinco contratos para servir
 * a um único caso.
 */
export class MariaDbIdentityUsageCounters implements IdentityUsageCounters {
  public constructor(private readonly connection: Queryable) {}

  private async contar(tabela: string, identityPublicId: string): Promise<number> {
    // `tabela` nunca vem de entrada externa — é literal de código, uma
    // das cinco abaixo. O identificador é sempre parametrizado.
    const [rows] = await this.connection.execute(
      `SELECT COUNT(*) AS total FROM ${tabela} WHERE identity_public_id = ?`,
      [identityPublicId]
    );
    return Number((rows as { total: number | string }[])[0]?.total ?? 0);
  }

  public async countCredentials(identityPublicId: string): Promise<number> {
    return this.contar("credentials", identityPublicId);
  }

  public async countExternalReferences(identityPublicId: string): Promise<number> {
    return this.contar("identity_external_references", identityPublicId);
  }

  public async countMemberships(identityPublicId: string): Promise<number> {
    return this.contar("memberships", identityPublicId);
  }

  public async countApplicationAccesses(identityPublicId: string): Promise<number> {
    return this.contar("application_accesses", identityPublicId);
  }

  public async countSessions(identityPublicId: string): Promise<number> {
    return this.contar("sessions", identityPublicId);
  }
}
