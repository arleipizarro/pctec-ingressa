import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { DomainError } from "../../../shared/errors/DomainError.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { IdentityExternalReferenceRepository } from "../../identity/domain/IdentityExternalReferenceRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import { SystemCode } from "../../identity/domain/value-objects/SystemCode.js";
import { EntityType } from "../../identity/domain/value-objects/EntityType.js";
import { LegacyId } from "../../identity/domain/value-objects/LegacyId.js";
import { ActorPublicId } from "../../identity/domain/value-objects/ActorPublicId.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { ApplicationRepository } from "../../application/domain/ApplicationRepository.js";
import type { ApplicationAccessRepository } from "../../application/domain/ApplicationAccessRepository.js";
import { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";
import { HELPDESK_APPLICATION_CODE, HELPDESK_SOURCE_ENTITY, HELPDESK_SOURCE_SYSTEM, HELPDESK_REQUIRED_PROFILE } from "./GetHelpdeskUserContextService.js";

/** Aplicação administrativa da plataforma — onde vive o perfil ADMIN. */
export const PLATFORM_APPLICATION_CODE = "PCTEC_INGRESSA" as const;
export const PLATFORM_ADMIN_PROFILE = "ADMIN" as const;

export class FederatedIdentityNotLinkedError extends DomainError {
  public readonly code = "FEDERATED_IDENTITY_NOT_LINKED";
  public readonly classification = "VALIDATION" as const;

  constructor(legacyUserId: string | number) {
    super(
      `não há IdentityExternalReference ACTIVE de ${HELPDESK_SOURCE_SYSTEM} para o usuário ${legacyUserId} — ` +
        "ativar identidade que o importador não vinculou criaria acesso que ninguém pediu."
    );
  }
}

export class FederatedIdentityNotActivatableError extends DomainError {
  public readonly code = "FEDERATED_IDENTITY_NOT_ACTIVATABLE";
  public readonly classification = "CONFLICT" as const;

  constructor(status: string) {
    super(
      `identidade está ${status} — a ativação federada só sai de PENDING. ` +
        "Reativar identidade bloqueada, inativada ou excluída é outra decisão, com outro fluxo."
    );
  }
}

export class FederatedActivationApproverNotEligibleError extends DomainError {
  public readonly code = "FEDERATED_ACTIVATION_APPROVER_NOT_ELIGIBLE";
  public readonly classification = "AUTHORIZATION" as const;

  constructor(motivo: string) {
    super(`aprovador não elegível: ${motivo}.`);
  }
}

export interface ActivateFederatedIdentityRequest {
  readonly legacyUserId: string | number;
  readonly approvedByIdentityPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface ActivateFederatedIdentityResult {
  readonly identityPublicId: string;
  readonly status: string;
  /** `true` quando a identidade já estava ACTIVE e nada foi escrito. */
  readonly alreadyActive: boolean;
}

export interface ActivateFederatedIdentityDeps {
  readonly unitOfWork: UnitOfWork;
  readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository;
  readonly identityExternalReferenceRepositoryFactory: (connection: Queryable) => IdentityExternalReferenceRepository;
  readonly applicationRepositoryFactory: (connection: Queryable) => ApplicationRepository;
  readonly applicationAccessRepositoryFactory: (connection: Queryable) => ApplicationAccessRepository;
  readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository;
}

/**
 * Ativa uma Identity **federada**: aquela cuja autenticação acontece em
 * outro sistema — hoje, o Helpdesk.
 *
 * O problema que este serviço resolve: `Identity.create` nasce PENDING
 * porque, no fluxo nativo, ACTIVE é consequência do bootstrap de
 * credencial. Usuário federado nunca terá credencial aqui (nenhuma
 * senha foi importada, e nenhuma será), então ele ficaria PENDING para
 * sempre — e PENDING não recebe contexto. Ativar por `UPDATE` manual
 * resolveria o sintoma e destruiria a explicação: ninguém saberia quem
 * ativou, quando, nem com base em quê.
 *
 * As três provas exigidas antes de ativar, nesta ordem:
 *
 * 1. **Aprovador** ACTIVE e com `ApplicationAccess(PCTEC_INGRESSA, ADMIN)`
 *    — ativar identidade é ato administrativo da plataforma, não do
 *    Helpdesk; por isso o perfil é verificado na aplicação da
 *    plataforma, não na aplicação consumidora.
 * 2. **Vínculo**: existe `IdentityExternalReference` ACTIVE de
 *    `PCTEC_HELPDESK`/`users` para aquele `users.id`.
 * 3. **Acesso**: a identidade alvo já tem `ApplicationAccess`
 *    `PCTEC_HELPDESK` GRANTED. Sem isso, ativar não serviria para nada
 *    e ainda deixaria uma identidade ativa sem propósito.
 *
 * **Idempotente**: identidade já ACTIVE devolve sucesso sem escrever
 * nada — reexecutar o comando depois de uma queda de conexão não pode
 * virar erro operacional nem gerar segundo evento de auditoria.
 *
 * **Nunca cria Credential.** Não há caminho neste código que toque a
 * tabela `credentials`: a autenticação continua sendo do Helpdesk.
 */
export class ActivateFederatedIdentityService {
  public constructor(private readonly deps: ActivateFederatedIdentityDeps) {}

  public async execute(request: ActivateFederatedIdentityRequest): Promise<ActivateFederatedIdentityResult> {
    const correlationId = request.correlationId ?? randomUUID();

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.deps.identityRepositoryFactory(connection);
      const referenceRepository = this.deps.identityExternalReferenceRepositoryFactory(connection);
      const auditEventRepository = this.deps.auditEventRepositoryFactory(connection);
      const autorizar = new AuthorizeApplicationAccessService(
        this.deps.applicationRepositoryFactory(connection),
        this.deps.applicationAccessRepositoryFactory(connection)
      );

      // 1. Aprovador — antes de qualquer leitura do alvo.
      const aprovadorPublicId = request.approvedByIdentityPublicId.trim();
      if (aprovadorPublicId.length === 0) {
        throw new FederatedActivationApproverNotEligibleError("não informado");
      }
      const aprovador = await identityRepository.findByPublicId(
        IdentityPublicId.fromString(aprovadorPublicId)
      );
      if (aprovador === undefined) {
        throw new FederatedActivationApproverNotEligibleError("identidade não existe");
      }
      if (aprovador.getStatus().toString() !== "ACTIVE") {
        throw new FederatedActivationApproverNotEligibleError(
          `identidade está ${aprovador.getStatus().toString()}`
        );
      }
      await autorizar.execute({
        identityPublicId: aprovadorPublicId,
        applicationCode: PLATFORM_APPLICATION_CODE,
        requiredProfile: PLATFORM_ADMIN_PROFILE
      });

      // 2. Vínculo federado.
      const referencia = await referenceRepository.findActiveBySystemCodeEntityTypeAndLegacyId(
        SystemCode.create(HELPDESK_SOURCE_SYSTEM),
        EntityType.create(HELPDESK_SOURCE_ENTITY),
        LegacyId.create(request.legacyUserId)
      );
      if (referencia === undefined) {
        throw new FederatedIdentityNotLinkedError(request.legacyUserId);
      }
      const identityPublicId = referencia.getIdentityPublicId();

      const identidade = await identityRepository.findByPublicId(
        IdentityPublicId.fromString(identityPublicId)
      );
      if (identidade === undefined) {
        throw new FederatedIdentityNotLinkedError(request.legacyUserId);
      }

      // 3. Acesso à aplicação consumidora — ativar sem acesso não serve
      //    a nada e deixa identidade ativa sem propósito.
      await autorizar.execute({
        identityPublicId,
        applicationCode: HELPDESK_APPLICATION_CODE,
        requiredProfile: HELPDESK_REQUIRED_PROFILE
      });

      const status = identidade.getStatus().toString();
      if (status === "ACTIVE") {
        return { identityPublicId, status, alreadyActive: true };
      }
      if (status !== "PENDING") {
        throw new FederatedIdentityNotActivatableError(status);
      }

      // Versão capturada ANTES da mutação — é ela que vai para o
      // `update` como expectativa otimista. Derivá-la depois
      // (`getVersion() - 1`) daria no mesmo hoje e passaria a mentir no
      // dia em que uma transição bumpar diferente. Mesmo padrão de
      // `BootstrapFirstCredentialService`.
      const versaoOriginal = identidade.getVersion();
      identidade.activate({
        actor: ActorPublicId.required(aprovadorPublicId),
        expectedVersion: versaoOriginal,
        correlationId
      });
      // `activate` muda só o status. `login_enabled` continua 0: usuário
      // federado não autentica no Ingressa, e habilitar login aqui
      // criaria uma porta que ninguém pediu.
      await identityRepository.update(identidade, versaoOriginal);

      const eventos = identidade.pullDomainEvents().map((evento) => AuditEvent.fromDomainEvent(evento));
      await auditEventRepository.insertMany(eventos);

      return {
        identityPublicId,
        status: identidade.getStatus().toString(),
        alreadyActive: false
      };
    });
  }
}
