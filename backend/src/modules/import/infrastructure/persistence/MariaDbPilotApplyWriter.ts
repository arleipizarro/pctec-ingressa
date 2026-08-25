import type { UnitOfWork } from "../../../../shared/database/UnitOfWork.js";
import { DomainError } from "../../../../shared/errors/DomainError.js";
import { MariaDbAuditEventRepository } from "../../../audit/infrastructure/MariaDbAuditEventRepository.js";
import { CreateIdentityService } from "../../../identity/application/CreateIdentityService.js";
import { CreateIdentityExternalReferenceService } from "../../../identity/application/CreateIdentityExternalReferenceService.js";
import { MariaDbIdentityRepository } from "../../../identity/infrastructure/persistence/MariaDbIdentityRepository.js";
import { MariaDbIdentityExternalReferenceRepository } from "../../../identity/infrastructure/persistence/MariaDbIdentityExternalReferenceRepository.js";
import { CreateMembershipService } from "../../../organization/application/CreateMembershipService.js";
import { MariaDbMembershipRepository } from "../../../organization/infrastructure/persistence/MariaDbMembershipRepository.js";
import { MariaDbOrganizationRepository } from "../../../organization/infrastructure/persistence/MariaDbOrganizationRepository.js";
import { GrantApplicationAccessService } from "../../../application/application/GrantApplicationAccessService.js";
import { MariaDbApplicationRepository } from "../../../application/infrastructure/persistence/MariaDbApplicationRepository.js";
import { MariaDbApplicationAccessRepository } from "../../../application/infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { ExistingConnectionUnitOfWork } from "../../application/ExistingConnectionUnitOfWork.js";
import type { PilotApplyWriteResult, PilotApplyWriter } from "../../application/RunHelpdeskPilotImportService.js";
import {
  PILOT_ACCESS_PROFILE,
  PILOT_MEMBERSHIP_PROFILE,
  PILOT_MEMBERSHIP_SCOPE,
  PILOT_SOURCE_ENTITY,
  PILOT_SOURCE_SYSTEM
} from "../../domain/pilot/HelpdeskPilotScope.js";

export class PilotActionNotApplicableError extends DomainError {
  public readonly code = "IMPORT_PILOT_ACTION_NOT_APPLICABLE";
  public readonly classification = "VALIDATION" as const;

  constructor(entityKind: string, action: string) {
    super(
      `ação ${action} sobre ${entityKind} não é aplicável nesta fatia. ` +
        "O dry-run pode propô-la; aplicá-la exige um caminho de atualização que ainda não existe."
    );
  }
}

export class PilotIdentityNotResolvedError extends DomainError {
  public readonly code = "IMPORT_PILOT_IDENTITY_NOT_RESOLVED";
  public readonly classification = "VALIDATION" as const;

  constructor(legacyId: number) {
    super(`identidade de destino do usuário ${legacyId} não pôde ser resolvida antes das escritas dependentes.`);
  }
}

/**
 * Escritor do APPLY — UMA transação por usuário.
 *
 * Reusa os Application Services de cada módulo (Identity, Membership,
 * ApplicationAccess) em vez de reimplementar as regras deles. O que
 * torna isso atômico é o `ExistingConnectionUnitOfWork`: dentro da
 * transação aberta aqui, o `runInTransaction` de cada serviço executa
 * sobre esta mesma conexão, e o COMMIT acontece uma vez só, no fim.
 *
 * Consequência prática — e é a que interessa ao piloto: se a concessão
 * de acesso falhar, a Identity, a referência externa e a membership
 * criadas antes dela desaparecem no ROLLBACK. Não fica pessoa
 * pela metade no banco, e não é preciso compensar o que nunca foi
 * comitado. A compensação documentada em
 * `docs/import/ROLLBACK-COMPENSACOES.md` continua sendo o caminho para
 * desfazer um lote JÁ CONCLUÍDO — problema diferente deste.
 *
 * A trilha entra no mesmo COMMIT: `recordItems` é chamado com a conexão
 * da transação, antes do retorno.
 */
export class MariaDbPilotApplyWriter implements PilotApplyWriter {
  public constructor(private readonly unitOfWork: UnitOfWork) {}

  public async writeUser(input: {
    readonly user: import("../../domain/pilot/HelpdeskSourcePort.js").HelpdeskUserRecord;
    readonly plan: import("../../domain/pilot/HelpdeskPilotPlanner.js").UserPlan;
    readonly organizationPublicId: string;
    readonly applicationCode: string;
    readonly actorPublicId: string;
    readonly recordItems: (
      connection: import("../../../../shared/database/Queryable.js").Queryable,
      targets: Readonly<Record<string, string>>
    ) => Promise<void>;
  }): Promise<PilotApplyWriteResult> {
    const { user, plan, organizationPublicId, applicationCode, actorPublicId, recordItems } = input;

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

      let identityPublicId: string | undefined;

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
          throw new PilotActionNotApplicableError(item.entityKind, item.action);
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
              systemCode: PILOT_SOURCE_SYSTEM,
              entityType: PILOT_SOURCE_ENTITY,
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
              organizationPublicId,
              profile: PILOT_MEMBERSHIP_PROFILE,
              scope: PILOT_MEMBERSHIP_SCOPE,
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
              accessProfile: PILOT_ACCESS_PROFILE,
              grantedByIdentityPublicId: actorPublicId
            });
            targets["APPLICATION_ACCESS"] = acesso.applicationAccessPublicId;
            break;
          }
        }
      }

      await recordItems(connection, targets);

      return {
        identityPublicId: requireIdentity(identityPublicId, user.id),
        targetPublicIdByEntityKind: targets
      };
    });
  }
}

function requireIdentity(identityPublicId: string | undefined, legacyId: number): string {
  if (identityPublicId === undefined) {
    throw new PilotIdentityNotResolvedError(legacyId);
  }
  return identityPublicId;
}
