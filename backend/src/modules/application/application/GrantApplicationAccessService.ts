import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { ApplicationRepository } from "../domain/ApplicationRepository.js";
import type { ApplicationAccessRepository } from "../domain/ApplicationAccessRepository.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { ApplicationAccess } from "../domain/ApplicationAccess.js";
import { ApplicationCode } from "../domain/value-objects/ApplicationCode.js";
import { AccessProfile } from "../domain/value-objects/AccessProfile.js";
import {
  ApplicationNotFoundError,
  IdentityNotFoundForAccessError,
  ApplicationAccessActiveGrantConflictError
} from "../domain/errors/ApplicationErrors.js";

export interface GrantApplicationAccessRequest {
  readonly identityPublicId: string;
  readonly applicationCode: string;
  readonly accessProfile: string;
  readonly grantedByIdentityPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface GrantApplicationAccessResult {
  readonly applicationAccessPublicId: string;
  readonly identityPublicId: string;
  readonly applicationCode: string;
  readonly accessProfile: string;
}

/**
 * Application Service para o comando genérico `ApplicationAccess.grant()`
 * — G3 (v0.6.x). Diferente de `BootstrapFirstApplicationAccessService`
 * (guard one-shot com named lock, exclusivo da concessão fundacional
 * `PCTEC_INGRESSA`/`ADMIN`): este service concede acesso a QUALQUER
 * Application/perfil, repetidamente, sempre com um
 * `grantedByIdentityPublicId` real — não é um evento único da vida da
 * plataforma, é um comando administrativo comum (mesmo princípio de
 * `CreateMembershipService`/`CreateOrganizationExternalReferenceService`:
 * checagem-antes-de-inserir dentro da mesma transação, sem named lock).
 *
 * Resolve `Application` por CÓDIGO (nunca UUID hardcoded), mesmo
 * princípio de `AuthorizeApplicationAccessService`.
 *
 * **Idempotência e concorrência (v0.8.x).** Conceder duas vezes o mesmo
 * acesso é sempre uma recusa explícita — `ApplicationAccessActiveGrantConflictError`
 * —, nunca uma segunda linha GRANTED. A recusa pode vir da checagem
 * prévia (caminho comum) ou da UNIQUE KEY do banco (corrida), e nos dois
 * casos o chamador recebe o mesmo erro de domínio. Um importador que
 * reprocessa um lote trata esse erro como SKIP, não como falha.
 *
 * **Troca de perfil (fatia futura).** Com um acesso ativo por identidade
 * por aplicação, mudar de USER para ADMIN deixa de ser "conceder de
 * novo": passa a ser revogar o acesso atual e conceder o novo DENTRO DA
 * MESMA transação. Este service já roda inteiro em
 * `unitOfWork.runInTransaction`, então a operação composta cabe aqui sem
 * mudança estrutural — falta apenas `ApplicationAccess.revoke()`, que
 * segue fora de escopo nesta fatia. Enquanto isso, a tentativa de trocar
 * de perfil falha de forma explícita em vez de duplicar o acesso.
 */
export class GrantApplicationAccessService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly applicationRepositoryFactory: (connection: Queryable) => ApplicationRepository,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly applicationAccessRepositoryFactory: (connection: Queryable) => ApplicationAccessRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: GrantApplicationAccessRequest): Promise<GrantApplicationAccessResult> {
    // Validação de formato acontece antes de qualquer acesso a
    // repositório — falha rápida.
    const applicationCode = ApplicationCode.create(request.applicationCode);
    const accessProfile = AccessProfile.create(request.accessProfile);
    const identityPublicId = IdentityPublicId.fromString(request.identityPublicId);
    const grantedByIdentityPublicId = IdentityPublicId.fromString(request.grantedByIdentityPublicId);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const applicationRepository = this.applicationRepositoryFactory(connection);
      const identityRepository = this.identityRepositoryFactory(connection);
      const applicationAccessRepository = this.applicationAccessRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const application = await applicationRepository.findByCode(applicationCode);
      if (application === undefined) {
        throw new ApplicationNotFoundError(request.applicationCode);
      }

      const identity = await identityRepository.findByPublicId(identityPublicId);
      if (identity === undefined) {
        throw new IdentityNotFoundForAccessError(identityPublicId.toString());
      }

      const applicationPublicId = application.getPublicId().toString();

      // Guard por (identidade, aplicação) — SEM o perfil. A regra é um
      // acesso ativo por identidade por aplicação; incluir o perfil aqui
      // era o furo que deixava USER e ADMIN coexistirem GRANTED.
      //
      // Esta checagem NÃO é a autoridade: ela existe para devolver um
      // erro legível no caminho comum. A autoridade é a UNIQUE KEY
      // `uk_app_access_active_grant` (migration 0017), porque
      // exists()+insert() tem janela de corrida (TOCTOU) — e o
      // importador em lote é exatamente o cenário que a abre. O
      // repositório traduz a violação do índice para o MESMO erro de
      // domínio, de modo que o chamador vê a mesma coisa venha a
      // recusa de onde vier.
      const alreadyGranted = await applicationAccessRepository.existsGrantedByIdentityAndApplication(
        identityPublicId.toString(),
        applicationPublicId
      );
      if (alreadyGranted) {
        throw new ApplicationAccessActiveGrantConflictError();
      }

      const applicationAccess = ApplicationAccess.grant({
        identityPublicId: identityPublicId.toString(),
        applicationPublicId,
        accessProfile: request.accessProfile,
        grantedByIdentityPublicId: grantedByIdentityPublicId.toString(),
        correlationId
      });

      await applicationAccessRepository.insert(applicationAccess);

      const events = applicationAccess.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      return {
        applicationAccessPublicId: applicationAccess.getPublicId().toString(),
        identityPublicId: identityPublicId.toString(),
        applicationCode: application.getCode().toString(),
        accessProfile: applicationAccess.getAccessProfile().toString()
      };
    });
  }
}
