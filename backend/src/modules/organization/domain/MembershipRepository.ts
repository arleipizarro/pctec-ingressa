import type { Membership } from "./Membership.js";
import type { PublicId } from "./value-objects/PublicId.js";
import type { MembershipProfile } from "./value-objects/MembershipProfile.js";

/**
 * Contrato de persistência de Membership.
 *
 * Definido no domínio, implementado na infraestrutura
 * (`infrastructure/persistence`). G2: inserção, leitura por Identity
 * (para `GetMembershipsByIdentityService`) e checagem de duplicidade
 * (`uk_membership_unique`) — nenhum `update` porque `Membership` não tem
 * comando de mutação nesta fatia.
 */
export interface MembershipRepository {
  /**
   * Usado por `CreateMembershipService` para checar
   * `uk_membership_unique (identity_public_id, organization_public_id,
   * profile)` antes do INSERT.
   */
  existsByIdentityOrganizationAndProfile(
    identityPublicId: string,
    organizationPublicId: string,
    profile: MembershipProfile
  ): Promise<boolean>;

  /** Usado por `GetMembershipsByIdentityService`. */
  findAllByIdentityPublicId(identityPublicId: string): Promise<Membership[]>;

  /**
   * Usado por `GetPortalContextService` (G3) — retorna só os Memberships
   * `status='ACTIVE'` de uma Identity. Deliberadamente um método
   * próprio, não um filtro em memória sobre `findAllByIdentityPublicId`:
   * o boundary de "o que conta para o PortalContext" fica explícito no
   * contrato do repository, não espalhado em cada chamador.
   */
  findActiveByIdentityPublicId(identityPublicId: string): Promise<Membership[]>;

  findByPublicId(publicId: PublicId): Promise<Membership | undefined>;

  insert(membership: Membership): Promise<void>;
}
