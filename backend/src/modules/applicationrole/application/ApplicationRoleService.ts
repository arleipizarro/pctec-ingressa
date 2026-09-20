import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import {
  createApplicationRoleGrantedEvent,
  createApplicationRoleRevokedEvent
} from "../domain/events/ApplicationRoleDomainEvents.js";
import {
  MariaDbApplicationRoleRepository,
  type ConcessaoComPessoa,
  type ConcessaoDePerfil,
  type PerfilDeAplicacao
} from "../infrastructure/persistence/MariaDbApplicationRoleRepository.js";
import {
  ApplicationRoleApplicationNotFoundError,
  ApplicationRoleAssignmentNotFoundError,
  ApplicationRoleIdentityNotEligibleError,
  ApplicationRoleNotInCatalogError
} from "./errors/ApplicationRoleErrors.js";

/**
 * Perfis de aplicação: catálogo, concessão e revogação.
 *
 * É este serviço que faz do Ingressa a FONTE OFICIAL da autorização de
 * um produto consumidor. Ele guarda quem tem qual perfil, quem
 * concedeu e quando; o produto consumidor carrega isso na sessão e
 * decide, no backend dele, o que cada perfil libera. Nenhuma das duas
 * pontas reimplementa a outra — e é exatamente por isso que não existe
 * uma segunda lista de concessões viva em lugar nenhum.
 *
 * A camada 1 continua mandando: conceder perfil a quem não tem
 * `ApplicationAccess` GRANTED na aplicação é recusado. Perfil sem acesso
 * seria uma autorização que não leva a lugar nenhum, guardada como se
 * levasse.
 */

export interface ResultadoDeConcessao {
  readonly assignmentPublicId: string;
  readonly roleCode: string;
  readonly changed: boolean;
}

export interface ApplicationRoleDeps {
  readonly pool: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository;
}

export class ApplicationRoleService {
  public constructor(private readonly deps: ApplicationRoleDeps) {}

  private repositorio(connection: Queryable = this.deps.pool): MariaDbApplicationRoleRepository {
    return new MariaDbApplicationRoleRepository(connection);
  }

  private async aplicacao(connection: Queryable, applicationCode: string): Promise<string> {
    const publicId = await this.repositorio(connection).aplicacaoPorCodigo(applicationCode);
    if (publicId === undefined) {
      throw new ApplicationRoleApplicationNotFoundError(applicationCode);
    }
    return publicId;
  }

  public async catalogo(applicationCode: string): Promise<readonly PerfilDeAplicacao[]> {
    return this.repositorio().catalogo(await this.aplicacao(this.deps.pool, applicationCode));
  }

  public async concessoes(applicationCode: string): Promise<readonly ConcessaoComPessoa[]> {
    return this.repositorio().concessoesDaAplicacao(await this.aplicacao(this.deps.pool, applicationCode));
  }

  public async concessoesDaPessoa(
    identityPublicId: string,
    applicationCode: string
  ): Promise<readonly ConcessaoDePerfil[]> {
    return this.repositorio().concessoesDaPessoa(
      identityPublicId,
      await this.aplicacao(this.deps.pool, applicationCode)
    );
  }

  /** Códigos GRANTED da pessoa — o formato que o produto consumidor carrega na sessão. */
  public async perfisConcedidos(identityPublicId: string, applicationCode: string): Promise<readonly string[]> {
    return this.repositorio().perfisConcedidos(
      identityPublicId,
      await this.aplicacao(this.deps.pool, applicationCode)
    );
  }

  /**
   * Concede um perfil.
   *
   * Idempotente: reconceder o que já vale devolve `changed: false` sem
   * tocar na linha e sem emitir evento. Um evento por tentativa
   * transformaria a auditoria em log de cliques.
   *
   * `grantedByLabel` só é usado quando NÃO há actor autenticado real
   * (reconciliação de bootstrap). Nunca um UUID inventado ocupando o
   * lugar de uma pessoa.
   */
  public async conceder(entrada: {
    readonly identityPublicId: string;
    readonly applicationCode: string;
    readonly roleCode: string;
    readonly grantedByIdentityPublicId?: string | undefined;
    readonly grantedByLabel?: string | undefined;
    readonly correlationId?: string | undefined;
  }): Promise<ResultadoDeConcessao> {
    const correlationId = entrada.correlationId ?? randomUUID();

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const repositorio = this.repositorio(connection);
      const applicationPublicId = await this.aplicacao(connection, entrada.applicationCode);

      const perfil = await repositorio.perfilNoCatalogo(applicationPublicId, entrada.roleCode);
      if (perfil === undefined) {
        throw new ApplicationRoleNotInCatalogError(entrada.roleCode, entrada.applicationCode);
      }
      if (!(await repositorio.identidadeElegivel(entrada.identityPublicId, applicationPublicId))) {
        throw new ApplicationRoleIdentityNotEligibleError();
      }

      const resultado = await repositorio.conceder({
        publicId: randomUUID(),
        identityPublicId: entrada.identityPublicId,
        applicationPublicId,
        roleCode: entrada.roleCode,
        grantedByIdentityPublicId: entrada.grantedByIdentityPublicId ?? null,
        grantedByLabel: entrada.grantedByIdentityPublicId === undefined ? (entrada.grantedByLabel ?? null) : null
      });

      if (resultado === null) {
        const ativa = (await repositorio.concessoesDaPessoa(entrada.identityPublicId, applicationPublicId)).find(
          (concessao) => concessao.roleCode === entrada.roleCode
        );
        return {
          assignmentPublicId: ativa?.publicId ?? "",
          roleCode: entrada.roleCode,
          changed: false
        };
      }

      await this.deps.auditEventRepositoryFactory(connection).insertMany([
        AuditEvent.fromDomainEvent(
          createApplicationRoleGrantedEvent(
            {
              aggregatePublicId: resultado.publicId,
              actorPublicId: entrada.grantedByIdentityPublicId ?? (entrada.grantedByLabel ?? "SYSTEM"),
              correlationId,
              occurredAt: new Date()
            },
            {
              assignmentPublicId: resultado.publicId,
              identityPublicId: entrada.identityPublicId,
              applicationPublicId,
              roleCode: entrada.roleCode
            }
          )
        )
      ]);

      return { assignmentPublicId: resultado.publicId, roleCode: entrada.roleCode, changed: true };
    });
  }

  /**
   * Revoga um perfil.
   *
   * Revogar o que não está concedido é RECUSADO, e não silenciado:
   * diferente da concessão, aqui o pedido descreve um estado que não
   * existe, e responder "feito" esconderia de quem opera que a
   * revogação que ela achava ter aplicado foi em outra pessoa.
   */
  public async revogar(entrada: {
    readonly identityPublicId: string;
    readonly applicationCode: string;
    readonly roleCode: string;
    readonly revokedByIdentityPublicId?: string | undefined;
    readonly correlationId?: string | undefined;
  }): Promise<ResultadoDeConcessao> {
    const correlationId = entrada.correlationId ?? randomUUID();

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const repositorio = this.repositorio(connection);
      const applicationPublicId = await this.aplicacao(connection, entrada.applicationCode);

      const resultado = await repositorio.revogar({
        identityPublicId: entrada.identityPublicId,
        applicationPublicId,
        roleCode: entrada.roleCode,
        revokedByIdentityPublicId: entrada.revokedByIdentityPublicId ?? null
      });
      if (resultado === null) {
        throw new ApplicationRoleAssignmentNotFoundError();
      }

      await this.deps.auditEventRepositoryFactory(connection).insertMany([
        AuditEvent.fromDomainEvent(
          createApplicationRoleRevokedEvent(
            {
              aggregatePublicId: resultado.publicId,
              actorPublicId: entrada.revokedByIdentityPublicId ?? "SYSTEM",
              correlationId,
              occurredAt: new Date()
            },
            {
              assignmentPublicId: resultado.publicId,
              identityPublicId: entrada.identityPublicId,
              applicationPublicId,
              roleCode: entrada.roleCode
            }
          )
        )
      ]);

      return { assignmentPublicId: resultado.publicId, roleCode: entrada.roleCode, changed: true };
    });
  }
}
