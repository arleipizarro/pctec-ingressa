import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { MembershipRepository } from "../domain/MembershipRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { PublicId as OrganizationPublicId } from "../domain/value-objects/PublicId.js";
import { MembershipNotFoundError } from "../domain/errors/MembershipErrors.js";

export interface EndMembershipRequest {
  readonly membershipPublicId: string;
  readonly reason: string;
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface EndMembershipResult {
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly organizationPublicId: string;
  readonly profile: string;
  readonly scope: string;
  readonly previousStatus: string;
  readonly status: string;
  readonly endedAt: string;
}

/**
 * Application Service para o comando EndMembership — P1D.1.
 *
 * **A operação segura de revogação de vínculo que faltava.** Até aqui o
 * módulo só sabia criar Memberships: o Aggregate não tinha comando de
 * mutação, o repository não tinha `update`, e nenhuma CLI encerrava
 * vínculo. Revogar um acesso exigia `UPDATE` manual no banco — sem
 * transação, sem evento, sem trilha de auditoria e sem controle de
 * concorrência. Este service fecha essa lacuna pelo mesmo caminho de
 * todos os outros comandos do Ingressa.
 *
 * Tudo na mesma transação: carregar o Membership, aplicar a transição no
 * Aggregate, persistir com optimistic locking, gravar
 * `membership.updated` em `audit_events`.
 *
 * **Encerrar não apaga.** A linha permanece, com `status=INACTIVE` e
 * `ended_at` preenchido — consultável, auditável, e provando que o
 * vínculo existiu. O efeito prático é que ela deixa de compor o
 * `PortalContext`, que lê exclusivamente
 * `findActiveByIdentityPublicId`. É por isso que revogar aqui remove o
 * acesso comercial sem tocar em nenhum dado do Portal legado.
 *
 * **Escopo deliberadamente estreito:** este service encerra UM
 * Membership, identificado pelo próprio `publicId`. Não recebe
 * `identityPublicId` + `organizationPublicId` como chave de busca — isso
 * convidaria a "encerrar o vínculo dessa pessoa com essa empresa" sem
 * que o operador tivesse olhado QUAL vínculo é, e o par
 * (identity, organization) pode ter mais de um `profile`. Quem chama
 * precisa ter lido o Membership antes; a CLI imprime o que vai encerrar
 * e exige confirmação.
 *
 * **Não decide se a revogação é legítima.** Não consulta
 * `ApplicationAccess`, não verifica se sobra algum vínculo, não impede
 * que uma Identity fique sem nenhuma Organization — "sem Membership" é
 * um estado válido (`GetPortalContextService` devolve lista vazia, 200).
 * Autorizar a operação é responsabilidade de quem opera a CLI.
 */
export class EndMembershipService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly membershipRepositoryFactory: (connection: Queryable) => MembershipRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: EndMembershipRequest): Promise<EndMembershipResult> {
    // Validação de formato antes de qualquer acesso a repositório —
    // falha rápida, mesmo padrão de CreateMembershipService.
    const membershipPublicId = OrganizationPublicId.fromString(request.membershipPublicId);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const membershipRepository = this.membershipRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const membership = await membershipRepository.findByPublicId(membershipPublicId);
      if (membership === undefined) {
        throw new MembershipNotFoundError(membershipPublicId.toString());
      }

      const previousStatus = membership.getStatus();
      // A versão lida ANTES da mutação é a que condiciona o UPDATE.
      const expectedVersion = membership.getVersion();

      // Lança MEMBERSHIP_ALREADY_ENDED se já estiver INACTIVE, e
      // MEMBERSHIP_END_REASON_INVALID se o motivo for vazio.
      membership.end({
        actorPublicId: request.actorPublicId,
        reason: request.reason,
        correlationId
      });

      await membershipRepository.update(membership, expectedVersion);

      const events = membership.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      const endedAt = membership.getEndedAt();
      return {
        publicId: membership.getPublicId().toString(),
        identityPublicId: membership.getIdentityPublicId(),
        organizationPublicId: membership.getOrganizationPublicId(),
        profile: membership.getProfile().toString(),
        scope: membership.getScope().toString(),
        previousStatus,
        status: membership.getStatus(),
        // `end()` sempre preenche endedAt; o fallback existe só para não
        // depender de non-null assertion num valor vindo do Aggregate.
        endedAt: endedAt === undefined ? "" : endedAt.toISOString()
      };
    });
  }
}
