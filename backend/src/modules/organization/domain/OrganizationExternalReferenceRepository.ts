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

  /**
   * Usado por `GetActiveOrganizationExternalReferenceService` — resolve
   * a referência `ACTIVE` de uma Organization para um sistema/entidade
   * legados específicos. Método novo, menor possível: não existia busca
   * por `(organizationPublicId, systemCode, entityType, status=ACTIVE)`
   * antes desta fatia — todos os métodos existentes exigiam já saber o
   * `legacyId` (`existsActiveBySystemCodeEntityTypeAndLegacyId`) ou o
   * `publicId` da própria referência (`findByPublicId`), nenhum dos
   * dois serve para "dado uma Organization já autorizada, qual é o
   * `legacyId` dela para este sistema?" — exatamente o que a API
   * `GET /api/v1/portal/organizations/:publicId/external-references/PCTEC_PORTAL`
   * precisa responder.
   */
  findActiveByOrganizationSystemCodeAndEntityType(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<OrganizationExternalReference | undefined>;

  /**
   * TODAS as referências ACTIVE de uma Organization num
   * `(systemCode, entityType)` — sem `LIMIT`, sem escolher.
   *
   * `findActiveByOrganizationSystemCodeAndEntityType` responde "uma
   * delas" e é honesto onde a ambiguidade já foi descartada antes. Onde
   * ela ainda pode existir — a leitura administrativa, o gate de
   * provisionamento, a criação do vínculo —, devolver "uma delas"
   * ESCONDE o problema: a tela mostraria um `legacyId` arbitrário como
   * se fosse o vínculo da empresa, e o próximo `LIMIT 1` do Portal
   * poderia escolher o outro. Quem precisa decidir olha a lista inteira.
   *
   * Obrigatório no contrato, e não opcional: uma implementação que não
   * saiba responder isto não deve compilar. Um `?` aqui viraria, na
   * prática, "volta a usar LIMIT 1 quando não der".
   */
  findAllActiveByOrganizationSystemCodeAndEntityType(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<readonly OrganizationExternalReference[]>;

  /**
   * Conta as referências ACTIVE de uma Organization num
   * `(systemCode, entityType)`.
   *
   * A UNIQUE KEY cobre "duas ACTIVE para o MESMO legacyId"; ela não
   * cobre "uma Organization com DUAS referências ACTIVE apontando para
   * legacyIds diferentes no mesmo sistema" — que é exatamente a
   * ambiguidade que a fronteira service-to-service precisa recusar em
   * vez de escolher. `findActive...` devolveria uma delas em silêncio.
   *
   * Opcional no contrato para não obrigar test doubles existentes.
   */
  countActiveByOrganizationSystemCodeAndEntityType?(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<number>;

  insert(reference: OrganizationExternalReference): Promise<void>;
}
