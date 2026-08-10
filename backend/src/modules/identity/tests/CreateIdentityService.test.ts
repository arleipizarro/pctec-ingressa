import { describe, it, expect } from "vitest";
import { CreateIdentityService } from "../application/CreateIdentityService.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { Identity } from "../domain/Identity.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import {
  IdentityEmailAlreadyExistsError,
  IdentityCpfAlreadyExistsError
} from "../domain/errors/IdentityErrors.js";

/**
 * Fakes em memória — nenhum destes testes toca SQL, mysql2 ou qualquer
 * conexão de rede/banco real.
 */
class InMemoryIdentityRepository implements IdentityRepository {
  public readonly stored = new Map<string, Identity>();
  private readonly emails = new Set<string>();
  private readonly cpfs = new Set<string>();

  public async findByPublicId(publicId: PublicId): Promise<Identity | undefined> {
    return this.stored.get(publicId.toString());
  }

  public async findByNormalizedEmail(normalizedEmail: string): Promise<Identity | undefined> {
    for (const identity of this.stored.values()) {
      if (identity.getEmail().normalized() === normalizedEmail) {
        return identity;
      }
    }
    return undefined;
  }

  public async existsByNormalizedEmail(normalizedEmail: string): Promise<boolean> {
    return this.emails.has(normalizedEmail);
  }

  public async existsByNormalizedCpf(normalizedCpf: string): Promise<boolean> {
    return this.cpfs.has(normalizedCpf);
  }

  public async countAll(): Promise<number> {
    return this.stored.size;
  }

  public async insert(identity: Identity): Promise<void> {
    this.stored.set(identity.getPublicId().toString(), identity);
    this.emails.add(identity.getEmail().normalized());
    const cpf = identity.getCpf();
    if (cpf !== undefined) {
      this.cpfs.add(cpf.normalized());
    }
    identity.assignInternalIdFromPersistence(this.stored.size);
  }

  public async update(): Promise<void> {
    // não exercitado por CreateIdentityService
  }
}

class InMemoryAuditEventRepository implements AuditEventRepository {
  public readonly events: AuditEvent[] = [];

  public async insert(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

class NoopUnitOfWork implements UnitOfWork {
  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    // Fake Queryable nunca é usado de fato pelas factories nos testes
    // abaixo, pois as factories retornam sempre a mesma instância de
    // repositório fake, ignorando o parâmetro `connection`.
    const fakeConnection: Queryable = {
      execute: async () => {
        throw new Error("Este teste não deveria executar SQL real.");
      }
    };
    return work(fakeConnection);
  }
}

function buildService(identityRepository: InMemoryIdentityRepository, auditEventRepository: InMemoryAuditEventRepository) {
  return new CreateIdentityService(
    new NoopUnitOfWork(),
    () => identityRepository,
    () => auditEventRepository
  );
}

describe("CreateIdentityService", () => {
  it("cria uma Identity, persiste e grava o evento de auditoria correspondente", async () => {
    const identityRepository = new InMemoryIdentityRepository();
    const auditEventRepository = new InMemoryAuditEventRepository();
    const service = buildService(identityRepository, auditEventRepository);

    const result = await service.execute({
      type: "HUMAN",
      fullName: "Pessoa Application Service",
      email: "app-service@example.com",
      actorPublicId: "SYSTEM"
    });

    expect(result.status).toBe("PENDING");
    expect(result.version).toBe(1);
    expect(identityRepository.stored.has(result.publicId)).toBe(true);
    expect(auditEventRepository.events).toHaveLength(1);
    expect(auditEventRepository.events[0]?.eventType).toBe("identity.created");
  });

  it("rejeita e-mail já existente com IDENTITY_EMAIL_ALREADY_EXISTS, sem persistir nada", async () => {
    const identityRepository = new InMemoryIdentityRepository();
    const auditEventRepository = new InMemoryAuditEventRepository();
    const service = buildService(identityRepository, auditEventRepository);

    await service.execute({
      type: "HUMAN",
      fullName: "Primeira Pessoa",
      email: "duplicado@example.com",
      actorPublicId: "SYSTEM"
    });

    await expect(
      service.execute({
        type: "HUMAN",
        fullName: "Segunda Pessoa",
        email: "Duplicado@Example.com", // mesma normalizedEmail, caixa diferente
        actorPublicId: "SYSTEM"
      })
    ).rejects.toThrow(IdentityEmailAlreadyExistsError);

    expect(identityRepository.stored.size).toBe(1);
  });

  it("rejeita CPF já existente com IDENTITY_CPF_ALREADY_EXISTS", async () => {
    const identityRepository = new InMemoryIdentityRepository();
    const auditEventRepository = new InMemoryAuditEventRepository();
    const service = buildService(identityRepository, auditEventRepository);

    await service.execute({
      type: "HUMAN",
      fullName: "Primeira Pessoa Com CPF",
      email: "primeira-cpf@example.com",
      cpf: "111.222.333-44",
      actorPublicId: "SYSTEM"
    });

    await expect(
      service.execute({
        type: "HUMAN",
        fullName: "Segunda Pessoa Com CPF",
        email: "segunda-cpf@example.com",
        cpf: "111.222.333-44",
        actorPublicId: "SYSTEM"
      })
    ).rejects.toThrow(IdentityCpfAlreadyExistsError);
  });

  it("gera um correlationId automaticamente quando não informado", async () => {
    const identityRepository = new InMemoryIdentityRepository();
    const auditEventRepository = new InMemoryAuditEventRepository();
    const service = buildService(identityRepository, auditEventRepository);

    await service.execute({
      type: "HUMAN",
      fullName: "Sem Correlation Id",
      email: "sem-correlation@example.com",
      actorPublicId: "SYSTEM"
    });

    expect(auditEventRepository.events[0]?.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
