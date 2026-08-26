import type { Organization } from "./Organization.js";
import type { PublicId } from "./value-objects/PublicId.js";
import type { OrganizationType } from "./value-objects/OrganizationType.js";
import type { DocumentNumber } from "./value-objects/DocumentNumber.js";

/**
 * Contrato de persistência de Organization.
 *
 * Definido no domínio, implementado na infraestrutura
 * (`infrastructure/persistence`) — o domínio não conhece `mysql2` nem
 * qualquer detalhe de SQL. G1: apenas inserção (`insert`) e leitura —
 * nenhum `update` porque `Organization` não tem comando de mutação
 * nesta fatia (ver Organization.ts).
 */
export interface OrganizationRepository {
  findByPublicId(publicId: PublicId): Promise<Organization | undefined>;

  /**
   * Usado por `CreateOrganizationService` para checar a constraint
   * `uk_organizations_document_type` antes do INSERT (falha rápida, com
   * erro de domínio `OrganizationDocumentAlreadyExistsError`, em vez de
   * depender só do erro bruto do banco).
   */
  existsByDocumentNumberAndType(documentNumber: DocumentNumber, type: OrganizationType): Promise<boolean>;

  insert(organization: Organization): Promise<void>;

  /**
   * Persiste a correção de nomes com trava otimista:
   * `WHERE version = expectedVersion` (a versão ANTES da mutação em
   * memória), enquanto `SET version` recebe o valor absoluto final —
   * mesmo padrão já usado em `MariaDbIdentityRepository.update()`.
   * Nenhuma linha afetada significa que alguém escreveu no meio, e a
   * implementação lança `OrganizationVersionConflictError`.
   *
   * Só nomes: `type`, `document_number` e `status` nunca entram no `SET`.
   */
  update(organization: Organization, expectedVersion: number): Promise<void>;
}
