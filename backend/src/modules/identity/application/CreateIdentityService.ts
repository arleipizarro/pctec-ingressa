import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { Identity } from "../domain/Identity.js";
import { Email } from "../domain/value-objects/Email.js";
import { Cpf } from "../domain/value-objects/Cpf.js";
import { ActorPublicId } from "../domain/value-objects/ActorPublicId.js";
import {
  IdentityEmailAlreadyExistsError,
  IdentityCpfAlreadyExistsError
} from "../domain/errors/IdentityErrors.js";

export interface CreateIdentityRequest {
  readonly type: string;
  readonly fullName: string;
  readonly email: string;
  readonly cpf?: string | undefined;
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface CreateIdentityResult {
  readonly publicId: string;
  readonly status: string;
  readonly version: number;
}

/**
 * Application Service para o comando CreateIdentity.
 *
 * Orquestra: validação de unicidade (e-mail/CPF) via repositório,
 * construção do Aggregate, persistência da Identity e dos eventos de
 * auditoria resultantes — tudo na mesma transação (ver seção 11 do
 * prompt de implementação).
 *
 * Não é um CRUD genérico: cobre exclusivamente o comando CreateIdentity.
 */
export class CreateIdentityService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: CreateIdentityRequest): Promise<CreateIdentityResult> {
    // Validação de formato acontece antes de qualquer acesso a
    // repositório — falha rápida, sem custo de I/O para entradas
    // obviamente inválidas.
    const email = Email.create(request.email);
    const cpf = Cpf.createOptional(request.cpf);
    const actor = ActorPublicId.required(request.actorPublicId);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.identityRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const emailAlreadyExists = await identityRepository.existsByNormalizedEmail(email.normalized());
      if (emailAlreadyExists) {
        throw new IdentityEmailAlreadyExistsError();
      }

      if (cpf !== undefined) {
        const cpfAlreadyExists = await identityRepository.existsByNormalizedCpf(cpf.normalized());
        if (cpfAlreadyExists) {
          throw new IdentityCpfAlreadyExistsError();
        }
      }

      const identity = Identity.create({
        type: request.type,
        fullName: request.fullName,
        email: request.email,
        cpf: request.cpf,
        actor,
        correlationId
      });

      await identityRepository.insert(identity);

      const events = identity.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      return {
        publicId: identity.getPublicId().toString(),
        status: identity.getStatus().toString(),
        version: identity.getVersion()
      };
    });
  }
}
