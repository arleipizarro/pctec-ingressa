import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../../shared/database/UnitOfWork.js";
import { AuditEvent } from "../../../audit/domain/AuditEvent.js";
import type { AuditEventRepository } from "../../../audit/domain/AuditEventRepository.js";
import type { CentralServicosAuditEntry, CentralServicosPersistence } from "../../application/CentralServicosService.js";
import { DelegationAssertionAlreadyIssuedError } from "../../application/errors/CentralServicosErrors.js";
import type { CentralServicosRepository, IdentityAuthorizationRow } from "../../domain/CentralServicosRepository.js";
import type { DelegationAssertionRecord, NewDelegationAssertion } from "../../domain/DelegationAssertion.js";

interface LinhaAssercao {
  id: number | string;
  public_id: string;
  token_hash: string;
  issuer_application_public_id: string;
  audience_application_code: string;
  identity_public_id: string;
  ticket_id: number | string;
  idempotency_key: string;
  action_kind: string;
  content_sha256: string;
  issued_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

function paraRegistro(l: LinhaAssercao): DelegationAssertionRecord {
  return {
    id: Number(l.id),
    publicId: l.public_id,
    tokenHash: l.token_hash,
    issuerApplicationPublicId: l.issuer_application_public_id,
    audienceApplicationCode: l.audience_application_code,
    identityPublicId: l.identity_public_id,
    ticketId: Number(l.ticket_id),
    idempotencyKey: l.idempotency_key,
    actionKind: l.action_kind,
    contentSha256: l.content_sha256,
    issuedAt: l.issued_at,
    expiresAt: l.expires_at,
    consumedAt: l.consumed_at
  };
}

function ehDuplicidadeDaAcao(erro: unknown): boolean {
  const e = erro as { code?: string; errno?: number; sqlMessage?: string } | null;
  return (e?.code === "ER_DUP_ENTRY" || e?.errno === 1062) && /uk_delegation_assertions_action/.test(e?.sqlMessage ?? "");
}

export class MariaDbCentralServicosRepository implements CentralServicosRepository {
  public constructor(private readonly c: Queryable) {}

  public async identityAuthorization(identityPublicId: string, applicationPublicId: string): Promise<IdentityAuthorizationRow | undefined> {
    const [linhas] = await this.c.execute(
      `SELECT i.full_name, i.status,
              (SELECT a.access_profile
                 FROM application_accesses a
                WHERE a.identity_public_id = i.public_id AND a.application_public_id = ? AND a.status = 'GRANTED'
                ORDER BY FIELD(a.access_profile, 'ADMIN', 'USER')
                LIMIT 1) AS access_profile
         FROM identities i
        WHERE i.public_id = ? AND i.status <> 'DELETED'
        LIMIT 1`,
      [applicationPublicId, identityPublicId]
    );
    const l = (linhas as { full_name: string; status: string; access_profile: string | null }[])[0];
    return l ? { fullName: l.full_name, status: l.status, accessProfile: l.access_profile } : undefined;
  }

  public async grantedRoles(identityPublicId: string, applicationPublicId: string): Promise<readonly string[]> {
    const [linhas] = await this.c.execute(
      `SELECT a.role_code
         FROM application_role_assignments a
         JOIN application_roles r ON r.application_public_id = a.application_public_id AND r.code = a.role_code
        WHERE a.identity_public_id = ? AND a.application_public_id = ? AND a.status = 'GRANTED' AND r.status = 'ACTIVE'
        ORDER BY r.sort_order ASC, r.code ASC`,
      [identityPublicId, applicationPublicId]
    );
    return (linhas as { role_code: string }[]).map((l) => l.role_code);
  }

  public async insertAssertion(a: NewDelegationAssertion): Promise<void> {
    try {
      await this.c.execute(
        `INSERT INTO delegation_assertions
           (public_id, token_hash, issuer_application_public_id, audience_application_code, identity_public_id,
            ticket_id, idempotency_key, action_kind, content_sha256, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.publicId,
          a.tokenHash,
          a.issuerApplicationPublicId,
          a.audienceApplicationCode,
          a.identityPublicId,
          a.ticketId,
          a.idempotencyKey,
          a.actionKind,
          a.contentSha256,
          a.issuedAt,
          a.expiresAt
        ]
      );
    } catch (erro) {
      if (ehDuplicidadeDaAcao(erro)) throw new DelegationAssertionAlreadyIssuedError();
      throw erro;
    }
  }

  public async assertionByTokenHash(tokenHash: string): Promise<DelegationAssertionRecord | undefined> {
    const [linhas] = await this.c.execute("SELECT * FROM delegation_assertions WHERE token_hash = ? LIMIT 1", [tokenHash]);
    const l = (linhas as LinhaAssercao[])[0];
    return l ? paraRegistro(l) : undefined;
  }

  public async consumeAssertion(id: number, consumer: string, at: Date): Promise<boolean> {
    const [r] = await this.c.execute(
      "UPDATE delegation_assertions SET consumed_at = ?, consumed_by_consumer = ? WHERE id = ? AND consumed_at IS NULL",
      [at, consumer, id]
    );
    return (r as { affectedRows: number }).affectedRows === 1;
  }

  public async applicationCodeByPublicId(publicId: string): Promise<string | undefined> {
    const [linhas] = await this.c.execute("SELECT code FROM applications WHERE public_id = ? LIMIT 1", [publicId]);
    return (linhas as { code: string }[])[0]?.code;
  }
}

/** Persistência MariaDB: leitura pelo pool; escrita + auditoria numa transação. */
export class MariaDbCentralServicosPersistence implements CentralServicosPersistence {
  public readonly leitura: CentralServicosRepository;

  public constructor(
    pool: Pool,
    private readonly unitOfWork: UnitOfWork,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {
    this.leitura = new MariaDbCentralServicosRepository(pool);
  }

  public transacao<T>(
    fn: (repo: CentralServicosRepository, auditar: (e: CentralServicosAuditEntry) => Promise<void>) => Promise<T>
  ): Promise<T> {
    return this.unitOfWork.runInTransaction(async (connection) => {
      const auditar = async (e: CentralServicosAuditEntry): Promise<void> => {
        await this.auditEventRepositoryFactory(connection).insertMany([
          AuditEvent.fromDomainEvent({
            eventId: randomUUID(),
            eventType: e.eventType,
            eventVersion: 1,
            aggregatePublicId: e.aggregatePublicId,
            actorPublicId: e.actorPublicId,
            correlationId: e.correlationId,
            occurredAt: new Date(),
            payload: e.payload
          })
        ]);
      };
      return fn(new MariaDbCentralServicosRepository(connection), auditar);
    });
  }
}
