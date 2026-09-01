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
 * **As DUAS direções de resolução** (a segunda acrescentada na fundação
 * do PCTEC Meu RH):
 *
 * - **legado → Identity**: `findActiveBySystemCodeEntityTypeAndLegacyId`
 *   — dado o `legacyId`, encontra a referência (e com ela a Identity).
 *   É o que o Portal precisa: ele tem `portal_acesso.id` e quer saber
 *   qual `Identity.publicId` corresponde.
 * - **Identity → legado**:
 *   `findActiveByIdentityAndSystemCodeAndEntityType` — dada a Identity
 *   já autenticada, encontra qual registro do sistema de origem ela
 *   representa. É o que um produto que consome dados de um sistema
 *   externo precisa: ele tem a Identity da sessão e quer o id do
 *   registro correspondente na origem.
 *
 * A segunda direção é a que torna a referência um CONTRATO cross-system
 * explícito, e é ela que exige a invariante "no máximo 1 ACTIVE por
 * (identity_public_id, system_code, entity_type)" — garantida no banco
 * pela migration 0024. Sem essa unicidade, "qual registro esta pessoa
 * representa lá fora" seria uma pergunta com mais de uma resposta
 * possível, o que num contexto de dados pessoais (folha, holerite) é
 * falha crítica, não ambiguidade tolerável.
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

  /**
   * Direção **Identity → legado**: resolve a ÚNICA referência `ACTIVE`
   * de uma Identity num dado `(systemCode, entityType)`.
   *
   * `identityPublicId` é `string` simples, mesmo precedente já usado no
   * Aggregate e em `ApplicationAccess`/`Membership` para referência
   * cross-aggregate — a validação de formato é do chamador (VO
   * `PublicId`), nunca do SQL.
   *
   * A unicidade do resultado é garantida no BANCO
   * (`uk_id_ext_ref_active_binding`, migration 0024), não por `LIMIT 1`:
   * o `LIMIT` esconderia uma violação em vez de a impedir.
   */
  findActiveByIdentityAndSystemCodeAndEntityType(
    identityPublicId: string,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<IdentityExternalReference | undefined>;

  /**
   * Conta as referências ACTIVE de `(identityPublicId, systemCode,
   * entityType)`.
   *
   * Mesmo papel do `countActive...` da outra direção, e pelo mesmo
   * motivo: a UNIQUE KEY já impede duas linhas ACTIVE, e este método
   * existe para o caminho ANORMAL — restauração parcial de backup,
   * escrita manual, banco em que a 0024 ainda não foi aplicada. Nesses
   * casos a fronteira service-to-service precisa RECUSAR, em vez de
   * escolher silenciosamente uma das candidatas: escolher errado aqui
   * significa exibir dado trabalhista de outra pessoa.
   *
   * Opcional no contrato para não obrigar todo test double existente a
   * implementá-lo — mesma decisão já tomada para o `countActive...` da
   * direção legado→Identity.
   */
  countActiveByIdentityAndSystemCodeAndEntityType?(
    identityPublicId: string,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<number>;

  insert(reference: IdentityExternalReference): Promise<void>;
}
