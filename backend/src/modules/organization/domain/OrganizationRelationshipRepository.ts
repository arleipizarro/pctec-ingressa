import type { OrganizationRelationship } from "./OrganizationRelationship.js";
import type { PublicId } from "./value-objects/PublicId.js";

/**
 * Contrato de persistência de OrganizationRelationship.
 *
 * Definido no domínio, implementado na infraestrutura
 * (`infrastructure/persistence`). G1: apenas inserção e leitura por
 * child (para checar `uk_org_rel_child` antes do INSERT) — nenhum
 * `update`/`delete` nesta fatia.
 */
export interface OrganizationRelationshipRepository {
  /**
   * Usado por `CreateOrganizationRelationshipService` para checar a
   * constraint `uk_org_rel_child` antes do INSERT (falha rápida, com
   * erro de domínio `OrganizationRelationshipChildAlreadyLinkedError`,
   * em vez de depender só do erro bruto do banco).
   */
  existsByChildOrganizationPublicId(childOrganizationPublicId: PublicId): Promise<boolean>;

  insert(relationship: OrganizationRelationship): Promise<void>;
}
