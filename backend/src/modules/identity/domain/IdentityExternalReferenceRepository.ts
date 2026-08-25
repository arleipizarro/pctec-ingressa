import type { IdentityExternalReference } from "./IdentityExternalReference.js";
import type { PublicId } from "./value-objects/PublicId.js";
import type { SystemCode } from "./value-objects/SystemCode.js";
import type { EntityType } from "./value-objects/EntityType.js";
import type { LegacyId } from "./value-objects/LegacyId.js";

/**
 * Contrato de persistência de IdentityExternalReference.
 *
 * Definido no domínio, implementado na infraestrutura
 * (`infrastructure/persistence`). P1B.0: inserção, leitura por legacyId
 * (`GetActiveIdentityExternalReferenceService` — direção REVERSA) e
 * checagem da invariante "no máximo 1 referência ACTIVE por
 * (system_code, entity_type, legacy_id)" antes do INSERT.
 *
 * **Diferença fundamental de direção vs Organization:**
 * - Organization: `findActiveByOrganizationSystemCodeAndEntityType` →
 *   dado `organizationPublicId`, encontra o `legacyId` (Organization→legado).
 * - Identity: `findActiveBySystemCodeEntityTypeAndLegacyId` →
 *   dado `legacyId`, encontra a `IdentityExternalReference` (legado→Identity).
 *   O Portal tem `portal_acesso.id` e precisa descobrir `Identity.publicId`.
 */
export interface IdentityExternalReferenceRepository {
  /**
   * Usado por `CreateIdentityExternalReferenceService` para checar a
   * invariante "no máximo 1 referência ACTIVE por (system_code,
   * entity_type, legacy_id)" antes do INSERT — fast fail com mensagem
   * amigável. Referências `SUPERSEDED` NÃO contam.
   */
  existsActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<boolean>;

  findByPublicId(publicId: PublicId): Promise<IdentityExternalReference | undefined>;

  /**
   * Usado por `GetActiveIdentityExternalReferenceService` — resolve a
   * referência `ACTIVE` dado `(systemCode, entityType, legacyId)`.
   *
   * **Direção REVERSA:** o Portal tem o `legacyId` (portal_acesso.id) e
   * precisa descobrir qual `Identity.publicId` corresponde a ele — não o
   * contrário. Este método retorna a `IdentityExternalReference` inteira
   * (incluindo `identityPublicId`), que é o que o Portal precisa para
   * construir a chamada service-to-service subsequente.
   */
  findActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<IdentityExternalReference | undefined>;

  /**
   * Conta as referências ACTIVE de `(systemCode, entityType, legacyId)`.
   *
   * A UNIQUE KEY `uk_id_ext_ref_active_match` já impede duas linhas
   * ACTIVE para a mesma chave; este método existe para o caminho
   * ANORMAL — restauração parcial de backup, escrita manual — em que a
   * fronteira service-to-service precisa recusar em vez de escolher uma
   * das candidatas. `findActive...` devolveria uma delas sem sinalizar
   * que havia outra.
   *
   * Opcional no contrato para não obrigar todo test double existente a
   * implementá-lo; quem não implementa simplesmente não exerce a
   * checagem de ambiguidade.
   */
  countActiveBySystemCodeEntityTypeAndLegacyId?(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<number>;

  insert(reference: IdentityExternalReference): Promise<void>;
}
