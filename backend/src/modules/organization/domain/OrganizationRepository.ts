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
   * Persiste uma mutação com trava otimista.
   *
   * `expectedVersion` vai para o `WHERE`, não para o `SET`: é o banco
   * que decide se a linha ainda está na versão que foi revisada. Zero
   * linhas afetadas significa que alguém chegou antes — e isso vira
   * conflito, nunca sobrescrita silenciosa.
   */
  update(organization: Organization, expectedVersion: number): Promise<void>;
}
