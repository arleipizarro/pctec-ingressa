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
import type { CredentialRepository } from "../domain/CredentialRepository.js";
import { Credential } from "../domain/Credential.js";
import { CredentialType } from "../domain/value-objects/CredentialType.js";
import { PlainPassword } from "../domain/value-objects/PlainPassword.js";
import type { PasswordHash } from "../domain/value-objects/PasswordHash.js";
import { IdentityNotFoundForCredentialError } from "../domain/errors/CredentialErrors.js";
import {
  CredentialBootstrapAlreadyCompletedError,
  CredentialLockNotAcquiredError
} from "./errors/CredentialBootstrapErrors.js";

export interface PasswordHasher {
  hash(password: PlainPassword): Promise<PasswordHash>;
}

export interface BootstrapFirstCredentialRequest {
  readonly identityPublicId: string;
  readonly plainPassword: string;
  readonly plainPasswordConfirmation: string;
  readonly correlationId?: string | undefined;
}

export interface BootstrapFirstCredentialResult {
  readonly credentialPublicId: string;
  readonly identityPublicId: string;
  readonly credentialType: string;
  readonly identityStatus: string;
  readonly loginEnabled: boolean;
}

const LOCK_NAME = "pctec_ingressa_credential_bootstrap";
// Mesmo raciocínio dos dois bootstraps anteriores (ADR-027/028): CLI
// local, um operador humano, uma vez — não há razão para um timeout
// longo.
const LOCK_TIMEOUT_SECONDS = 10;

/**
 * Orquestra a criação da primeira Credential da plataforma — v0.5.x,
 * Fase C, `docs/adr/ADR-029-CREDENTIAL-E-AUTENTICACAO.md`.
 *
 * Deliberadamente NÃO reutiliza `CreateIdentityService` nem nenhum
 * serviço de criação de Identity — este serviço nunca cria uma Identity,
 * apenas credencia uma já existente.
 *
 * Mesmo desenho estrutural de `BootstrapFirstIdentityService` (ADR-027) e
 * `BootstrapFirstApplicationAccessService` (ADR-028):
 *
 * - `UnitOfWork` genérico NÃO é usado — o named lock precisa permanecer
 *   adquirido até depois do `COMMIT`, nunca antes.
 * - Toda a operação roda sobre UMA ÚNICA conexão física:
 *
 *     pool.getConnection() → GET_LOCK → BEGIN →
 *     guard global (existsAnyByType) → SELECT Identity → hash da senha →
 *     INSERT Credential → Identity.activate() → Identity.enableLogin() →
 *     UPDATE Identity (uma única chamada, version absoluta — ver nota em
 *     MariaDbIdentityRepository.update()) →
 *     INSERT AuditEvent(s) (credential.created, identity.activated,
 *     identity.login-enabled) → COMMIT → RELEASE_LOCK → release()
 *
 * `RELEASE_LOCK` só roda se o lock foi de fato adquirido. `rollback` só
 * roda se `BEGIN` já tiver ocorrido. `release()` da conexão sempre roda
 * no `finally` mais externo.
 *
 * **Guard GLOBAL, não por-Identity** (ADR-029, "Escopo exato do
 * bootstrap"): a condição de bloqueio é "já existe QUALQUER `Credential
 * LOCAL_PASSWORD` na plataforma inteira?", nunca "esta Identity já tem
 * Credential?" — isso é o que impede que este CLI vire um bypass
 * permanente de `MagicLink` para usuários futuros.
 *
 * Entrada recebe apenas `identityPublicId` + senha/confirmação — nunca
 * `actor`, `type`, `status`, `loginEnabled`, `publicId`, `passwordHash`
 * ou `version` (task, seção 12). `type` é sempre `LOCAL_PASSWORD`, fixo
 * no código, nunca parâmetro.
 */
export class BootstrapFirstCredentialService {
  public constructor(
    private readonly pool: BootstrapConnectionPool,
    private readonly credentialRepositoryFactory: (connection: Queryable) => CredentialRepository,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository,
    private readonly passwordHasher: PasswordHasher
  ) {}

  public async execute(request: BootstrapFirstCredentialRequest): Promise<BootstrapFirstCredentialResult> {
    const correlationId = request.correlationId ?? randomUUID();
    // Validações de formato acontecem antes de qualquer acesso a
    // repositório — falha rápida, sem custo de I/O para entradas
    // obviamente inválidas. A política de senha (comprimento mínimo +
    // blacklist, ADR-029) é aplicada aqui, dentro de PlainPassword.
    const identityPublicId = IdentityPublicId.fromString(request.identityPublicId);
    const plainPassword = PlainPassword.createWithConfirmation(
      request.plainPassword,
      request.plainPasswordConfirmation
    );

    const connection = await this.pool.getConnection();
    let lockAcquired = false;

    try {
      const [lockRows] = await connection.execute(`SELECT GET_LOCK(?, ?) AS acquired`, [
        LOCK_NAME,
        LOCK_TIMEOUT_SECONDS
      ]);
      const acquired = this.extractColumn(lockRows, "acquired");
      if (acquired !== 1 && acquired !== true) {
        throw new CredentialLockNotAcquiredError(LOCK_NAME, LOCK_TIMEOUT_SECONDS);
      }
      lockAcquired = true;

      return await this.runProtectedTransaction(connection, identityPublicId.toString(), plainPassword, correlationId);
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
    plainPassword: PlainPassword,
    correlationId: string
  ): Promise<BootstrapFirstCredentialResult> {
    const credentialRepository = this.credentialRepositoryFactory(connection);
    const identityRepository = this.identityRepositoryFactory(connection);
    const auditEventRepository = this.auditEventRepositoryFactory(connection);

    await connection.beginTransaction();
    try {
      const type = CredentialType.localPassword();

      // Guard GLOBAL one-shot — nunca por-identidade (ver docstring da
      // classe).
      const alreadyBootstrapped = await credentialRepository.existsAnyByType(type);
      if (alreadyBootstrapped) {
        throw new CredentialBootstrapAlreadyCompletedError();
      }

      const identity = await identityRepository.findByPublicId(IdentityPublicId.fromString(identityPublicId));
      if (identity === undefined) {
        throw new IdentityNotFoundForCredentialError(identityPublicId);
      }

      // Hash da senha — nunca a senha bruta persistida em nenhuma
      // variável fora do escopo mínimo necessário; PlainPassword expõe o
      // valor bruto apenas via `revealForHashing()`, consumido
      // exclusivamente aqui.
      const passwordHash = await this.passwordHasher.hash(plainPassword);

      const credential = Credential.createFoundational({
        identityPublicId,
        passwordHash,
        correlationId
      });

      await credentialRepository.insert(credential);

      const originalIdentityVersion = identity.getVersion();

      // Duas mutações de domínio em sequência sobre o MESMO agregado em
      // memória — cada uma incrementa `version` internamente. Uma única
      // chamada a `identityRepository.update()` ao final persiste o
      // valor ABSOLUTO final (ver nota na implementação do repository),
      // condicionada a `WHERE version = originalIdentityVersion` para o
      // optimistic locking real.
      //
      // Métodos bootstrap-específicos (não `activate()`/`enableLogin()`
      // genéricos com `actor` externo) — mantêm o marcador `"BOOTSTRAP"`
      // localizado dentro de `Identity`, este serviço nunca importa nem
      // constrói `ActorPublicId.bootstrap()` (revisão crítica, ver
      // `ActorPublicId.ts`).
      identity.activateForCredentialBootstrap({ expectedVersion: identity.getVersion(), correlationId });
      identity.enableLoginForCredentialBootstrap({ expectedVersion: identity.getVersion(), correlationId });

      await identityRepository.update(identity, originalIdentityVersion);

      const credentialEvents = credential.pullDomainEvents();
      const identityEvents = identity.pullDomainEvents();
      const auditEvents = [...credentialEvents, ...identityEvents].map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      await connection.commit();

      return {
        credentialPublicId: credential.getPublicId().toString(),
        identityPublicId,
        credentialType: type.toString(),
        identityStatus: identity.getStatus().toString(),
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
