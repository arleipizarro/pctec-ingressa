import type { OrganizationExternalReference } from "./OrganizationExternalReference.js";
import type { PublicId } from "./value-objects/PublicId.js";
import type { SystemCode } from "./value-objects/SystemCode.js";
import type { EntityType } from "./value-objects/EntityType.js";
import type { LegacyId } from "./value-objects/LegacyId.js";

/**
 * Contrato de persistência de OrganizationExternalReference.
 *
 * Definido no domínio, implementado na infraestrutura
 * (`infrastructure/persistence`). G2: inserção, leitura por publicId
 * (`GetOrganizationExternalReferenceService`) e checagem da invariante
 * "no máximo 1 referência ACTIVE por (system_code, entity_type,
 * legacy_id)" antes do INSERT — enforçada na camada de aplicação
 * (migration 0013), nunca `update` nesta fatia.
 */
export interface OrganizationExternalReferenceRepository {
  /**
   * Usado por `CreateOrganizationExternalReferenceService` para checar
   * a invariante "no máximo 1 referência ACTIVE por (system_code,
   * entity_type, legacy_id)" antes do INSERT — enforçada na camada de
   * aplicação, não por UNIQUE KEY (migration 0013, corrigida para
   * permitir múltiplas linhas SUPERSEDED coexistindo como histórico,
   * mesmo princípio de `application_accesses`, 0006). Filtra
   * `status = 'ACTIVE'` — uma referência SUPERSEDED NÃO conta como
   * existente para este propósito.
   */
  existsActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<boolean>;

  findByPublicId(publicId: PublicId): Promise<OrganizationExternalReference | undefined>;

  insert(reference: OrganizationExternalReference): Promise<void>;
}
