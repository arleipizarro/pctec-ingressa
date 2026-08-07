import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { Identity } from "../domain/Identity.js";
import { BootstrapAlreadyCompletedError, BootstrapLockNotAcquiredError } from "./errors/BootstrapErrors.js";

/**
 * Uma conexão física única (não um Pool), compatível estruturalmente com
 * `PoolConnection` de mysql2/promise — mesmo padrão já usado em
 * `MigrationRunner.ts`, estendido aqui com o ciclo de transação
 * explícito que o bootstrap exige (`beginTransaction`/`commit`/
 * `rollback`, além de `execute`/`release`).
 */
export interface BootstrapConnection extends Queryable {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

/** Compatível estruturalmente com `Pool` de mysql2/promise — só o que este serviço usa. */
export interface BootstrapConnectionPool {
  getConnection(): Promise<BootstrapConnection>;
}

export interface BootstrapFirstIdentityRequest {
  readonly fullName: string;
  readonly email: string;
  readonly cpf?: string | undefined;
  readonly correlationId?: string | undefined;
}

export interface BootstrapFirstIdentityResult {
  readonly publicId: string;
  readonly status: string;
  readonly loginEnabled: boolean;
}

const LOCK_NAME = "pctec_ingressa_identity_bootstrap";
// Pequeno e documentado deliberadamente: este CLI roda uma única vez, por
// um operador humano local — não há razão para esperar muito tempo por um
// lock que, na prática, só existiria se outra execução estivesse
// genuinamente em andamento no mesmo instante.
const LOCK_TIMEOUT_SECONDS = 10;

/**
 * Orquestra o bootstrap da primeira Identity fundacional da plataforma —
 * v0.5.0, `docs/adr/ADR-027-BOOTSTRAP-ADMINISTRATIVO-INICIAL.md`.
 *
 * Deliberadamente NÃO reaproveita `CreateIdentityService`: sua assinatura
 * atual (`actorPublicId: string`) alimenta, com o MESMO valor,
 * `createdByPublicId` (que precisa ser `undefined`/`NULL` no bootstrap) e
 * o `actorPublicId` do evento de auditoria (que precisa ser o marcador
 * `"BOOTSTRAP"`) — os dois precisam divergir aqui, o que
 * `CreateIdentityService`/`Identity.create()` não suportam sem alteração
 * (ver `Identity.createFoundational()`, usado exclusivamente por este
 * serviço).
 *
 * Toda a operação roda sobre UMA ÚNICA conexão física, do início ao fim:
 *
 *   pool.getConnection() → GET_LOCK → BEGIN → COUNT(identities) →
 *   INSERT Identity → INSERT AuditEvent → COMMIT → RELEASE_LOCK → release()
 *
 * `RELEASE_LOCK` só é chamado se o lock foi de fato adquirido. `rollback`
 * só é chamado se `BEGIN` já tiver ocorrido. `release()` da conexão
 * sempre roda no `finally` mais externo, mesmo se `GET_LOCK` falhar antes
 * de qualquer transação começar.
 */
export class BootstrapFirstIdentityService {
  public constructor(
    private readonly pool: BootstrapConnectionPool,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: BootstrapFirstIdentityRequest): Promise<BootstrapFirstIdentityResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const connection = await this.pool.getConnection();
    let lockAcquired = false;

    try {
      const [lockRows] = await connection.execute(`SELECT GET_LOCK(?, ?) AS acquired`, [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
      const acquired = this.extractColumn(lockRows, "acquired");
      if (acquired !== 1 && acquired !== true) {
        throw new BootstrapLockNotAcquiredError(LOCK_NAME, LOCK_TIMEOUT_SECONDS);
      }
      lockAcquired = true;

      return await this.runProtectedTransaction(connection, request, correlationId);
    } finally {
      if (lockAcquired) {
        await connection.execute(`SELECT RELEASE_LOCK(?) AS released`, [LOCK_NAME]);
      }
      connection.release();
    }
  }

  private async runProtectedTransaction(
    connection: BootstrapConnection,
    request: BootstrapFirstIdentityRequest,
    correlationId: string
  ): Promise<BootstrapFirstIdentityResult> {
    const identityRepository = this.identityRepositoryFactory(connection);
    const auditEventRepository = this.auditEventRepositoryFactory(connection);

    await connection.beginTransaction();
    try {
      // Guard one-shot: nunca depende de created_by/marcador/e-mail —
      // "existe QUALQUER Identity?" é a invariante mais forte (ver
      // ADR-027, seção "One-shot guard").
      const total = await identityRepository.countAll();
      if (total > 0) {
        throw new BootstrapAlreadyCompletedError();
      }

      const identity = Identity.createFoundational({
        fullName: request.fullName,
        email: request.email,
        cpf: request.cpf,
        correlationId
      });

      await identityRepository.insert(identity);

      const events = identity.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      await connection.commit();

      return {
        publicId: identity.getPublicId().toString(),
        status: identity.getStatus().toString(),
        loginEnabled: identity.isLoginEnabled()
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
