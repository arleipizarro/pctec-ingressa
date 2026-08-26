import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../../shared/database/UnitOfWork.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";
import { MariaDbAuditEventRepository } from "../../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateIdentityService } from "../../../identity/application/CreateIdentityService.js";
import { CreateIdentityExternalReferenceService } from "../../../identity/application/CreateIdentityExternalReferenceService.js";
import { MariaDbIdentityRepository } from "../../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbIdentityExternalReferenceRepository } from "../../../identity/infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { CreateMembershipService } from "../../../organization/application/CreateMembershipService.js";
import { CreateOrganizationService } from "../../../organization/application/CreateOrganizationService.js";
import { CreateOrganizationExternalReferenceService } from "../../../organization/application/CreateOrganizationExternalReferenceService.js";
import { CreateOrganizationRelationshipService } from "../../../organization/application/CreateOrganizationRelationshipService.js";
import { MariaDbMembershipRepository } from "../../../organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbOrganizationRepository } from "../../../organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { MariaDbOrganizationExternalReferenceRepository } from "../../../organization/infrastructure/persistence/MariaDbOrganizationExternalReferenceRepository.js";
import { MariaDbOrganizationRelationshipRepository } from "../../../organization/infrastructure/persistence/MariaDbOrganizationRelationshipRepository.js";
import { GrantApplicationAccessService } from "../../../application/application/GrantApplicationAccessService.js";
import { MariaDbApplicationRepository } from "../../../application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../../../application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { ActivateFederatedIdentityService } from "../../../helpdesk/application/ActivateFederatedIdentityService.js";
import { ExistingConnectionUnitOfWork } from "../../../../shared/database/ExistingConnectionUnitOfWork.js";
import type {
  WizardApplyWriter,
  WizardOrganizationWriteResult,
  WizardUserWriteResult,
  WriteOrganizationInput,
  WriteUserInput
} from "../../application/RunHelpdeskImportWizardService.js";
import {
  WIZARD_ACCESS_PROFILE,
  WIZARD_MEMBERSHIP_PROFILE,
  WIZARD_ORGANIZATION_TYPE_COMPANY,
  WIZARD_SOURCE_CLIENT_ENTITY,
  WIZARD_SOURCE_SYSTEM,
  WIZARD_SOURCE_USER_ENTITY
} from "../../domain/wizard/HelpdeskImportScope.js";
import { membershipScopeFor } from "../../domain/wizard/HelpdeskImportPlanner.js";

export class WizardActionNotApplicableError extends DomainError {
  public readonly code = "IMPORT_WIZARD_ACTION_NOT_APPLICABLE";
  public readonly classification = "VALIDATION" as const;

  constructor(entityKind: string, action: string) {
    super(
      `ação ${action} sobre ${entityKind} não é aplicável. O dry-run pode propô-la; ` +
        "aplicá-la exigiria um caminho de atualização que não existe."
    );
  }
}

export class WizardOrganizationNotResolvedError extends DomainError {
  public readonly code = "IMPORT_WIZARD_ORGANIZATION_NOT_RESOLVED";
  public readonly classification = "VALIDATION" as const;

  constructor(sourceClientId: number) {
    super(
      `organização de destino da empresa ${sourceClientId} não pôde ser resolvida antes das escritas ` +
        "dependentes. Nenhuma membership é criada apontando para destino desconhecido."
    );
  }
}

export class WizardIdentityNotResolvedError extends DomainError {
  public readonly code = "IMPORT_WIZARD_IDENTITY_NOT_RESOLVED";
  public readonly classification = "VALIDATION" as const;

  constructor(legacyId: number) {
    super(`identidade de destino do usuário ${legacyId} não pôde ser resolvida antes das escritas dependentes.`);
  }
}

/**
 * Escritor do APPLY do assistente.
 *
 * Duas transações de granularidades diferentes, por razões diferentes:
 *
 *  - **uma para a organização inteira** (empresa + referência externa +
 *    relação com o grupo). Elas nascem ou não nascem juntas: uma
 *    Organization sem a referência externa que a amarra ao `clients.id`
 *    é uma empresa órfã que a próxima execução não reconhece e duplica.
 *
 *  - **uma por usuário**, exatamente como no piloto. Se a concessão de
 *    acesso falhar, a Identity, a referência e a membership criadas
 *    antes dela desaparecem no ROLLBACK — não fica pessoa pela metade
 *    no banco.
 *
 * A ATIVAÇÃO FEDERADA entra na mesma transação do usuário, depois das
 * quatro escritas e antes do commit. É o que a task exige em outras
 * palavras — "ativar somente depois das três relações anteriores",
 * "falha antes da ativação deixa o usuário sem acesso utilizável" — e
 * numa transação única a garantia é ainda mais forte: falha depois da
 * ativação também não deixa nada, porque nada foi comitado.
 *
 * `ActivateFederatedIdentityService` roda sobre a MESMA conexão via
 * `ExistingConnectionUnitOfWork`, então ele enxerga as linhas recém
 * inseridas e revalida, por conta própria, que o aprovador é ADMIN em
 * PCTEC_INGRESSA e que a identidade tem acesso GRANTED em
 * PCTEC_HELPDESK. Revalidação redundante com a rota HTTP, e é para ser:
 * a rota protege a porta, isto protege a regra.
 *
 * **Nenhuma Credential é criada em lugar nenhum deste caminho.** Não há
 * import de `CredentialRepository` neste arquivo, e `login_enabled`
 * permanece 0 porque `Identity.activate()` só muda o status.
 */
export class MariaDbWizardApplyWriter implements WizardApplyWriter {
  public constructor(private readonly unitOfWork: UnitOfWork) {}

  public async writeOrganization(input: WriteOrganizationInput): Promise<WizardOrganizationWriteResult> {
    const { plan, client, parentBusinessGroupPublicId, actorPublicId, recordItems } = input;

    return this.unitOfWork.runInTransaction(async (connection) => {
      const inner = new ExistingConnectionUnitOfWork(connection);
      const targets: Record<string, string> = {};

      const createOrganization = new CreateOrganizationService(
        inner,
        (c) => new MariaDbOrganizationRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      );
      const createExternalReference = new CreateOrganizationExternalReferenceService(
        inner,
        (c) => new MariaDbOrganizationRepository(c),
        (c) => new MariaDbOrganizationExternalReferenceRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      );
      const createRelationship = new CreateOrganizationRelationshipService(
        inner,
        (c) => new MariaDbOrganizationRepository(c),
        (c) => new MariaDbOrganizationRelationshipRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      );

      let organizationPublicId = plan.existingOrganizationPublicId;

      for (const item of plan.items) {
        if (item.action === "SKIP") {
          if (item.existingTargetPublicId !== undefined) {
            targets[item.entityKind] = item.existingTargetPublicId;
          }
          continue;
        }
        if (item.action !== "CREATE") {
          throw new WizardActionNotApplicableError(item.entityKind, item.action);
        }

        switch (item.entityKind) {
          case "ORGANIZATION": {
            const criada = await createOrganization.execute({
              type: WIZARD_ORGANIZATION_TYPE_COMPANY,
              // A razão social vem do nome cadastral da origem. Não há
              // CNPJ para trazer: o grant projeta `clients(id, name,
              // active)` e nada mais.
              legalName: client.name,
              actorPublicId
            });
            organizationPublicId = criada.publicId;
            targets["ORGANIZATION"] = criada.publicId;
            break;
          }
          case "ORGANIZATION_EXTERNAL_REFERENCE": {
            const alvo = requireOrganization(organizationPublicId, client.id);
            const referencia = await createExternalReference.execute({
              organizationPublicId: alvo,
              systemCode: WIZARD_SOURCE_SYSTEM,
              entityType: WIZARD_SOURCE_CLIENT_ENTITY,
              legacyId: client.id,
              actorPublicId
            });
            targets["ORGANIZATION_EXTERNAL_REFERENCE"] = referencia.publicId;
            break;
          }
          default: {
            const filha = requireOrganization(organizationPublicId, client.id);
            const pai = requireOrganization(parentBusinessGroupPublicId, client.id);
            const relacao = await createRelationship.execute({
              parentOrganizationPublicId: pai,
              childOrganizationPublicId: filha,
              actorPublicId
            });
            targets["ORGANIZATION_RELATIONSHIP"] = relacao.publicId;
            break;
          }
        }
      }

      await recordItems(connection, targets);

      return {
        organizationPublicId: requireOrganization(organizationPublicId, client.id),
        targetPublicIdByEntityKind: targets
      };
    });
  }

  public async writeUser(input: WriteUserInput): Promise<WizardUserWriteResult> {
    const { user, plan, membershipOrganizationPublicId, applicationCode, actorPublicId, recordItems } = input;

    return this.unitOfWork.runInTransaction(async (connection) => {
      const inner = new ExistingConnectionUnitOfWork(connection);
      const targets: Record<string, string> = {};

      const createIdentity = new CreateIdentityService(
        inner,
        (c) => new MariaDbIdentityRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      );
      const createExternalReference = new CreateIdentityExternalReferenceService(
        inner,
        (c) => new MariaDbIdentityRepository(c),
        (c) => new MariaDbIdentityExternalReferenceRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      );
      const createMembership = new CreateMembershipService(
        inner,
        (c) => new MariaDbIdentityRepository(c),
        (c) => new MariaDbOrganizationRepository(c),
        (c) => new MariaDbMembershipRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      );
      const grantAccess = new GrantApplicationAccessService(
        inner,
        (c) => new MariaDbApplicationRepository(c),
        (c) => new MariaDbIdentityRepository(c),
        (c) => new MariaDbApplicationAccessRepository(c),
        (c) => new MariaDbAuditEventRepository(c)
      );
      const activateFederated = new ActivateFederatedIdentityService({
        unitOfWork: inner,
        identityRepositoryFactory: (c) => new MariaDbIdentityRepository(c),
        identityExternalReferenceRepositoryFactory: (c) => new MariaDbIdentityExternalReferenceRepository(c),
        applicationRepositoryFactory: (c) => new MariaDbApplicationRepository(c),
        applicationAccessRepositoryFactory: (c) => new MariaDbApplicationAccessRepository(c),
        auditEventRepositoryFactory: (c) => new MariaDbAuditEventRepository(c)
      });

      let identityPublicId = plan.existingIdentityPublicId;

      for (const item of plan.items) {
        if (item.action === "SKIP") {
          if (item.entityKind === "IDENTITY" && item.existingTargetPublicId !== undefined) {
            identityPublicId = item.existingTargetPublicId;
          }
          if (item.existingTargetPublicId !== undefined) {
            targets[item.entityKind] = item.existingTargetPublicId;
          }
          continue;
        }
        if (item.action !== "CREATE") {
          throw new WizardActionNotApplicableError(item.entityKind, item.action);
        }

        switch (item.entityKind) {
          case "IDENTITY": {
            const criada = await createIdentity.execute({
              type: "HUMAN",
              fullName: user.name,
              email: user.email,
              actorPublicId
            });
            identityPublicId = criada.publicId;
            targets["IDENTITY"] = criada.publicId;
            break;
          }
          case "IDENTITY_EXTERNAL_REFERENCE": {
            const alvo = requireIdentity(identityPublicId, user.id);
            const referencia = await createExternalReference.execute({
              identityPublicId: alvo,
              systemCode: WIZARD_SOURCE_SYSTEM,
              entityType: WIZARD_SOURCE_USER_ENTITY,
              legacyId: user.id,
              matchMethod: "CREATED_FROM_SOURCE",
              actorPublicId
            });
            targets["IDENTITY_EXTERNAL_REFERENCE"] = referencia.publicId;
            break;
          }
          case "MEMBERSHIP": {
            const alvo = requireIdentity(identityPublicId, user.id);
            const membership = await createMembership.execute({
              identityPublicId: alvo,
              organizationPublicId: membershipOrganizationPublicId,
              profile: WIZARD_MEMBERSHIP_PROFILE,
              // O escopo sai do VÍNCULO, não do corpo da requisição.
              scope: membershipScopeFor(plan.linkKind),
              actorPublicId
            });
            targets["MEMBERSHIP"] = membership.publicId;
            break;
          }
          default: {
            const alvo = requireIdentity(identityPublicId, user.id);
            const acesso = await grantAccess.execute({
              identityPublicId: alvo,
              applicationCode,
              accessProfile: WIZARD_ACCESS_PROFILE,
              grantedByIdentityPublicId: actorPublicId
            });
            targets["APPLICATION_ACCESS"] = acesso.applicationAccessPublicId;
            break;
          }
        }
      }

      // Ativação por ÚLTIMO, e só quando as três relações e a concessão
      // já existem nesta transação. Idempotente: identidade já ACTIVE
      // devolve `alreadyActive` sem escrever nem auditar de novo.
      const ativacao = await activateFederated.execute({
        legacyUserId: user.id,
        approvedByIdentityPublicId: actorPublicId
      });

      await recordItems(connection, targets);

      return {
        identityPublicId: requireIdentity(identityPublicId ?? ativacao.identityPublicId, user.id),
        identityStatus: ativacao.status,
        activatedNow: !ativacao.alreadyActive,
        targetPublicIdByEntityKind: targets
      };
    });
  }
}

function requireOrganization(publicId: string | undefined | null, sourceClientId: number): string {
  if (publicId === undefined || publicId === null || publicId.length === 0) {
    throw new WizardOrganizationNotResolvedError(sourceClientId);
  }
  return publicId;
}

function requireIdentity(publicId: string | undefined, legacyId: number): string {
  if (publicId === undefined) {
    throw new WizardIdentityNotResolvedError(legacyId);
  }
  return publicId;
}
