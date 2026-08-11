import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { MembershipRepository } from "../domain/MembershipRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { Membership } from "../domain/Membership.js";
import { MembershipProfile } from "../domain/value-objects/MembershipProfile.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import { PublicId as OrganizationPublicId } from "../domain/value-objects/PublicId.js";
import {
  MembershipIdentityNotFoundError,
  MembershipOrganizationNotFoundError,
  MembershipOrganizationNotActiveError,
  MembershipAlreadyExistsError
} from "../domain/errors/MembershipErrors.js";

export interface CreateMembershipRequest {
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly profile: string;
  readonly scope: string;
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface CreateMembershipResult {
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly profile: string;
  readonly scope: string;
  readonly status: string;
}

/**
 * Application Service para o comando CreateMembership.
 *
 * Único lugar onde as pré-condições de `Membership.create()` são
 * verificadas (o Aggregate não tem acesso a repositórios — mesmo
 * princípio já usado em `CreateOrganizationRelationshipService`, G1):
 *
 * 1. `Identity` precisa existir (`IDENTITY_NOT_FOUND`);
 * 2. `Organization` precisa existir (`ORGANIZATION_NOT_FOUND`);
 * 3. `Organization` precisa estar `ACTIVE`
 *    (`MEMBERSHIP_ORGANIZATION_NOT_ACTIVE`);
 * 4. nenhum Membership com a mesma classificação (identity + organization
 *    + profile) já exista (`MEMBERSHIP_ALREADY_EXISTS`,
 *    `uk_membership_unique`).
 *
 * Tudo na mesma transação: carregar Identity/Organization, validar,
 * checar duplicidade, construir o Aggregate, persistir, gravar o evento
 * de auditoria (`membership.created`).
 *
 * **Nunca consulta IDs internos de HUB/Helpdesk/Portal** — só
 * `identities.public_id`/`organizations.public_id`, ambos já canônicos
 * do Ingressa.
 */
export class CreateMembershipService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    private readonly membershipRepositoryFactory: (connection: Queryable) => MembershipRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: CreateMembershipRequest): Promise<CreateMembershipResult> {
    // Validação de formato dos publicIds acontece antes de qualquer
    // acesso a repositório — falha rápida.
    const identityPublicId = IdentityPublicId.fromString(request.identityPublicId);
    const organizationPublicId = OrganizationPublicId.fromString(request.organizationPublicId);
    const profile = MembershipProfile.create(request.profile);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.identityRepositoryFactory(connection);
      const organizationRepository = this.organizationRepositoryFactory(connection);
      const membershipRepository = this.membershipRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const identity = await identityRepository.findByPublicId(identityPublicId);
      if (identity === undefined) {
        throw new MembershipIdentityNotFoundError(identityPublicId.toString());
      }

      const organization = await organizationRepository.findByPublicId(organizationPublicId);
      if (organization === undefined) {
        throw new MembershipOrganizationNotFoundError(organizationPublicId.toString());
      }
      if (!organization.isActive()) {
        throw new MembershipOrganizationNotActiveError();
      }

      const alreadyExists = await membershipRepository.existsByIdentityOrganizationAndProfile(
        identityPublicId.toString(),
        organizationPublicId.toString(),
        profile
      );
      if (alreadyExists) {
        throw new MembershipAlreadyExistsError();
      }

      const membership = Membership.create({
        identityPublicId: identityPublicId.toString(),
        organizationPublicId: organizationPublicId.toString(),
        profile: request.profile,
        scope: request.scope,
        actorPublicId: request.actorPublicId,
        correlationId
      });

      await membershipRepository.insert(membership);

      const events = membership.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      return {
        publicId: membership.getPublicId().toString(),
        identityPublicId: membership.getIdentityPublicId(),
        organizationPublicId: membership.getOrganizationPublicId(),
        profile: membership.getProfile().toString(),
        scope: membership.getScope().toString(),
        status: membership.getStatus()
      };
    });
  }
}
