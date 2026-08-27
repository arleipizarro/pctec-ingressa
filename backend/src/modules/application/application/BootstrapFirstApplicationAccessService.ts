import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type {
  BootstrapConnection,
  BootstrapConnectionPool
} from "../../identity/application/BootstrapFirstIdentityService.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { PublicId as IdentityPublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { ApplicationRepository } from "../domain/ApplicationRepository.js";
import type { ApplicationAccessRepository } from "../domain/ApplicationAccessRepository.js";
import { ApplicationAccess } from "../domain/ApplicationAccess.js";
import { AccessProfile } from "../domain/value-objects/AccessProfile.js";
import { ApplicationCode } from "../domain/value-objects/ApplicationCode.js";
import { PCTEC_INGRESSA_APPLICATION_CODE } from "../domain/value-objects/ApplicationCodes.js";
import { ApplicationNotFoundError, IdentityNotFoundForAccessError } from "../domain/errors/ApplicationErrors.js";
import {
  ApplicationAccessBootstrapAlreadyCompletedError,
  FoundationalIdentityAmbiguousError,
  ApplicationAccessLockNotAcquiredError
} from "./errors/ApplicationAccessBootstrapErrors.js";

export interface BootstrapFirstApplicationAccessRequest {
  readonly identityPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface BootstrapFirstApplicationAccessResult {
  readonly applicationAccessPublicId: string;
  readonly identityPublicId: string;
  readonly applicationPublicId: string;
  readonly accessProfile: string;
}

const LOCK_NAME = "pctec_ingressa_application_access_bootstrap";
// Mesmo raciocínio do bootstrap de Identity (ADR-027): CLI local, um
// operador humano, uma vez — não há razão para um timeout longo.
const LOCK_TIMEOUT_SECONDS = 10;

/**
 * Orquestra a primeira concessão administrativa da plataforma — v0.5.0,
 * `docs/adr/ADR-028-APPLICATION-ACCESS-E-ACESSO-ADMINISTRATIVO.md`.
 *
 * Mesmo desenho estrutural de `BootstrapFirstIdentityService` (ADR-027),
 * deliberadamente replicado por consistência e pelos MESMOS motivos:
 *
 * - `UnitOfWork` genérico NÃO é usado — o named lock precisa permanecer
 *   adquirido até depois do `COMMIT`, nunca antes (mesma corrida real já
 *   documentada em ADR-027).
 * - Toda a operação roda sobre UMA ÚNICA conexão física:
 *
 *     pool.getConnection() → GET_LOCK → BEGIN → SELECT Application →
 *     SELECT Identity → verificar ausência de ADMIN já concedido →
 *     INSERT ApplicationAccess → INSERT AuditEvent → COMMIT →
 *     RELEASE_LOCK → release()
 *
 * `RELEASE_LOCK` só roda se o lock foi de fato adquirido. `rollback` só
 * roda se `BEGIN` já tiver ocorrido. `release()` da conexão sempre roda
 * no `finally` mais externo.
 *
 * Entrada recebe `identityPublicId` do chamador — NUNCA hardcoded (task
 * v0.5.0, seção 8). A aplicação concedida é sempre `PCTEC_INGRESSA`, o
 * perfil é sempre `ADMIN` — o CLI nunca aceita esses dois valores como
 * parâmetro arbitrário (seção 17).
 */
export class BootstrapFirstApplicationAccessService {
  public constructor(
    private readonly pool: BootstrapConnectionPool,
    private readonly applicationRepositoryFactory: (connection: Queryable) => ApplicationRepository,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly applicationAccessRepositoryFactory: (connection: Queryable) => ApplicationAccessRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(
    request: BootstrapFirstApplicationAccessRequest
  ): Promise<BootstrapFirstApplicationAccessResult> {
    const correlationId = request.correlationId ?? randomUUID();
    // Validação de formato acontece antes de qualquer acesso a
    // repositório — falha rápida.
    const identityPublicId = IdentityPublicId.fromString(request.identityPublicId);

    const connection = await this.pool.getConnection();
    let lockAcquired = false;

    try {
      const [lockRows] = await connection.execute(`SELECT GET_LOCK(?, ?) AS acquired`, [
        LOCK_NAME,
        LOCK_TIMEOUT_SECONDS
      ]);
      const acquired = this.extractColumn(lockRows, "acquired");
      if (acquired !== 1 && acquired !== true) {
        throw new ApplicationAccessLockNotAcquiredError(LOCK_NAME, LOCK_TIMEOUT_SECONDS);
      }
      lockAcquired = true;

      return await this.runProtectedTransaction(connection, identityPublicId.toString(), correlationId);
    } finally {
      if (lockAcquired) {
        await connection.execute(`SELECT RELEASE_LOCK(?) AS released`, [LOCK_NAME]);
      }
      connection.release();
    }
  }

  private async runProtectedTransaction(
    connection: BootstrapConnection,
    identityPublicId: string,
    correlationId: string
  ): Promise<BootstrapFirstApplicationAccessResult> {
    const applicationRepository = this.applicationRepositoryFactory(connection);
    const identityRepository = this.identityRepositoryFactory(connection);
    const applicationAccessRepository = this.applicationAccessRepositoryFactory(connection);
    const auditEventRepository = this.auditEventRepositoryFactory(connection);

    await connection.beginTransaction();
    try {
      const applicationCode = ApplicationCode.create(PCTEC_INGRESSA_APPLICATION_CODE);
      const application = await applicationRepository.findByCode(applicationCode);
      if (application === undefined) {
        throw new ApplicationNotFoundError(PCTEC_INGRESSA_APPLICATION_CODE);
      }

      const identity = await identityRepository.findByPublicId(IdentityPublicId.fromString(identityPublicId));
      if (identity === undefined) {
        throw new IdentityNotFoundForAccessError(identityPublicId);
      }

      // Guard de unicidade fundacional (v1.0, ADR-027 emenda): o CLI só
      // promove A Identity fundacional, e "fundacional" só é uma noção
      // bem definida enquanto ela for a ÚNICA. Com duas ou mais, o
      // `publicId` recebido por parâmetro passaria a DECIDIR quem manda
      // na plataforma — e um dígito trocado escolheria a conta errada
      // sem que nada aqui pudesse perceber.
      //
      // Dentro da mesma transação e sob o mesmo lock dos guards abaixo,
      // então a contagem não pode mudar entre a leitura e a concessão.
      const identityCount = await identityRepository.countAll();
      if (identityCount !== 1) {
        throw new FoundationalIdentityAmbiguousError(identityCount);
      }

      const accessProfile = AccessProfile.admin();
      const applicationPublicId = application.getPublicId().toString();

      // Guard one-shot: nenhum ApplicationAccess ADMIN já concedido para
      // PCTEC_INGRESSA — invariante mais forte que "esta Identity não
      // tem acesso", análoga a COUNT(identities)=0 do bootstrap de
      // Identity (ADR-027): não depende de qual Identity recebeu o
      // acesso, apenas de que a raiz administrativa já existe ou não.
      const adminAlreadyGranted = await applicationAccessRepository.existsGrantedByApplicationAndProfile(
        applicationPublicId,
        accessProfile.toString()
      );
      if (adminAlreadyGranted) {
        throw new ApplicationAccessBootstrapAlreadyCompletedError();
      }

      // Guard adicional explícito (seção 8): duplicidade para a mesma
      // tripla identidade/aplicação/perfil — redundante com o guard
      // acima nesta fatia (só existe uma Application ADMIN-alvo), mas
      // mantido pela robustez a mudanças futuras (ex.: múltiplas
      // Applications ADMIN) e por ser exigido explicitamente pela task.
      const duplicateForIdentity = await applicationAccessRepository.existsGrantedByIdentityApplicationAndProfile(
        identityPublicId,
        applicationPublicId,
        accessProfile.toString()
      );
      if (duplicateForIdentity) {
        throw new ApplicationAccessBootstrapAlreadyCompletedError();
      }

      const applicationAccess = ApplicationAccess.grantFoundationalAdminAccess({
        identityPublicId,
        applicationPublicId,
        correlationId
      });

      await applicationAccessRepository.insert(applicationAccess);

      const events = applicationAccess.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      await connection.commit();

      return {
        applicationAccessPublicId: applicationAccess.getPublicId().toString(),
        identityPublicId,
        applicationPublicId,
        accessProfile: accessProfile.toString()
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }

  private extractColumn(rows: unknown, column: string): unknown {
    const rowList = rows as Array<Record<string, unknown>>;
    return rowList[0]?.[column];
  }
}
