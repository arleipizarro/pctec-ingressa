import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { DomainError } from "../../../shared/errors/DomainError.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { createIdentityDiscardedEvent } from "../domain/events/IdentityDomainEvents.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { ApplicationRepository } from "../../application/domain/ApplicationRepository.js";
import type { ApplicationAccessRepository } from "../../application/domain/ApplicationAccessRepository.js";
import { AuthorizeApplicationAccessService } from "../../authorization/application/AuthorizeApplicationAccessService.js";

export const PLATFORM_APPLICATION_CODE = "PCTEC_INGRESSA" as const;
export const PLATFORM_ADMIN_PROFILE = "ADMIN" as const;
export const DISCARD_REASON_CODE = "TEST_DATA_CLEANUP" as const;

export class IdentityNotDiscardableError extends DomainError {
  public readonly code = "IDENTITY_NOT_DISCARDABLE";
  public readonly classification = "CONFLICT" as const;

  constructor(motivo: string) {
    super(`identidade não pode ser descartada: ${motivo}.`);
  }
}

export class IdentityToDiscardNotFoundError extends DomainError {
  public readonly code = "IDENTITY_TO_DISCARD_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(publicId: string) {
    super(`identidade ${publicId} não encontrada.`);
  }
}

export class DiscardApproverNotEligibleError extends DomainError {
  public readonly code = "DISCARD_APPROVER_NOT_ELIGIBLE";
  public readonly classification = "AUTHORIZATION" as const;

  constructor(motivo: string) {
    super(`aprovador não elegível: ${motivo}.`);
  }
}

/** Contagens de vínculo — o service não sabe SQL, só recebe os números. */
export interface IdentityUsageCounters {
  countCredentials(identityPublicId: string): Promise<number>;
  countExternalReferences(identityPublicId: string): Promise<number>;
  countMemberships(identityPublicId: string): Promise<number>;
  countApplicationAccesses(identityPublicId: string): Promise<number>;
  countSessions(identityPublicId: string): Promise<number>;
}

export interface DiscardUnusedPendingIdentityRequest {
  readonly identityPublicId: string;
  readonly approvedByIdentityPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface DiscardUnusedPendingIdentityResult {
  readonly identityPublicId: string;
  readonly discarded: boolean;
  /** `true` quando a identidade já não existia — reexecução segura. */
  readonly alreadyAbsent: boolean;
}

export interface DiscardUnusedPendingIdentityDeps {
  readonly unitOfWork: UnitOfWork;
  readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository;
  readonly usageCountersFactory: (connection: Queryable) => IdentityUsageCounters;
  readonly applicationRepositoryFactory: (connection: Queryable) => ApplicationRepository;
  readonly applicationAccessRepositoryFactory: (connection: Queryable) => ApplicationAccessRepository;
  readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository;
}

/**
 * Descarta FISICAMENTE uma Identity PENDING que nunca foi usada.
 *
 * O alvo é sempre um `publicId` explícito. Não existe busca por nome ou
 * e-mail, e a ausência é deliberada: um filtro do tipo "apague quem se
 * chama Synthetic" transformaria um erro de digitação — ou um cadastro
 * real com nome parecido — em exclusão silenciosa de gente de verdade.
 *
 * Sete pré-condições, todas verificadas dentro da mesma transação em que
 * o DELETE acontece. Verificar antes e apagar depois, fora da transação,
 * deixaria a janela em que alguém cria uma sessão para a identidade
 * entre a checagem e a remoção.
 *
 * A remoção é física porque exclusão lógica não resolve o problema que
 * ela existe para resolver: a linha continuaria na base e na tela. O
 * evento `identity.discarded` passa a ser o único registro de que ela
 * existiu — por isso carrega o `reasonCode`, e por isso nunca carrega
 * nome ou e-mail.
 */
export class DiscardUnusedPendingIdentityService {
  public constructor(private readonly deps: DiscardUnusedPendingIdentityDeps) {}

  public async execute(
    request: DiscardUnusedPendingIdentityRequest
  ): Promise<DiscardUnusedPendingIdentityResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const alvo = PublicId.fromString(request.identityPublicId);
    const aprovadorPublicId = request.approvedByIdentityPublicId.trim();
    if (aprovadorPublicId.length === 0) {
      throw new DiscardApproverNotEligibleError("não informado");
    }

    return this.deps.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.deps.identityRepositoryFactory(connection);
      const contadores = this.deps.usageCountersFactory(connection);
      const auditEventRepository = this.deps.auditEventRepositoryFactory(connection);

      // 1. Aprovador: ACTIVE e ADMIN na aplicação da plataforma.
      const aprovador = await identityRepository.findByPublicId(PublicId.fromString(aprovadorPublicId));
      if (aprovador === undefined) {
        throw new DiscardApproverNotEligibleError("identidade não existe");
      }
      if (aprovador.getStatus().toString() !== "ACTIVE") {
        throw new DiscardApproverNotEligibleError(`identidade está ${aprovador.getStatus().toString()}`);
      }
      await new AuthorizeApplicationAccessService(
        this.deps.applicationRepositoryFactory(connection),
        this.deps.applicationAccessRepositoryFactory(connection)
      ).execute({
        identityPublicId: aprovadorPublicId,
        applicationCode: PLATFORM_APPLICATION_CODE,
        requiredProfile: PLATFORM_ADMIN_PROFILE
      });

      // 2. Alvo. Ausente = já descartado: reexecutar não é erro.
      const identidade = await identityRepository.findByPublicId(alvo);
      if (identidade === undefined) {
        return { identityPublicId: alvo.toString(), discarded: false, alreadyAbsent: true };
      }
      if (identidade.getPublicId().toString() === aprovadorPublicId) {
        throw new IdentityNotDiscardableError("o aprovador não pode descartar a própria identidade");
      }
      if (identidade.getStatus().toString() !== "PENDING") {
        throw new IdentityNotDiscardableError(
          `status é ${identidade.getStatus().toString()}, e só PENDING é descartável`
        );
      }
      if (identidade.isLoginEnabled()) {
        throw new IdentityNotDiscardableError("login está habilitado");
      }

      // 3. Nenhum vínculo, de nenhum tipo.
      const alvoId = alvo.toString();
      const vinculos: readonly (readonly [string, number])[] = [
        ["credencial", await contadores.countCredentials(alvoId)],
        ["referência externa", await contadores.countExternalReferences(alvoId)],
        ["membership", await contadores.countMemberships(alvoId)],
        ["acesso a aplicação", await contadores.countApplicationAccesses(alvoId)],
        ["sessão", await contadores.countSessions(alvoId)]
      ];
      for (const [nome, total] of vinculos) {
        if (total > 0) {
          throw new IdentityNotDiscardableError(`possui ${total} ${nome}(s)`);
        }
      }

      // 4. Auditoria ANTES do DELETE: se a escrita do evento falhar, a
      //    transação inteira volta e a linha permanece — nunca o
      //    contrário, que apagaria sem deixar rastro.
      await auditEventRepository.insertMany([
        AuditEvent.fromDomainEvent(
          createIdentityDiscardedEvent(
            {
              aggregatePublicId: alvoId,
              actorPublicId: aprovadorPublicId,
              correlationId,
              occurredAt: new Date()
            },
            { publicId: alvoId, reasonCode: DISCARD_REASON_CODE }
          )
        )
      ]);

      const remover = identityRepository.deleteByPublicId;
      if (remover === undefined) {
        throw new IdentityNotDiscardableError("repositório não suporta descarte físico");
      }
      const afetadas = await remover.call(identityRepository, alvo, identidade.getVersion());
      if (afetadas === 0) {
        throw new IdentityNotDiscardableError(
          "a identidade mudou desde a verificação — nada foi removido"
        );
      }

      return { identityPublicId: alvoId, discarded: true, alreadyAbsent: false };
    });
  }
}
