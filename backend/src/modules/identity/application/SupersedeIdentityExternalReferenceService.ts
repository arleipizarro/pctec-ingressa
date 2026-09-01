import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { IdentityExternalReferenceRepository } from "../domain/IdentityExternalReferenceRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import {
  IdentityExternalReferenceAlreadyExistsError,
  IdentityExternalReferenceNotFoundByPublicIdError
} from "../domain/errors/IdentityExternalReferenceErrors.js";

export interface SupersedeIdentityExternalReferenceRequest {
  /** `publicId` da referência a superar — nunca o `legacyId`. */
  readonly referencePublicId: string;
  readonly reason: string;
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
  /**
   * Quando presente, a MESMA Identity passa a representar OUTRO registro
   * no MESMO `(systemCode, entityType)` — o caso de correção de vínculo.
   *
   * Ausente: o vínculo apenas deixa de valer, sem sucessor
   * (`IDENTITY_OFFBOARDED`).
   *
   * `systemCode`, `entityType` e `identityPublicId` NÃO são parâmetros:
   * vêm da referência superada, por construção. Deixá-los entrar
   * permitiria "substituir" a referência de A por uma de B, que não é
   * substituição — é criar um vínculo novo para outra pessoa, operação
   * que tem seu próprio comando.
   */
  readonly replacement?:
    | {
        readonly legacyId: string | number;
        readonly matchMethod: string;
      }
    | undefined;
}

export interface SupersedeIdentityExternalReferenceResult {
  readonly supersededPublicId: string;
  readonly replacementPublicId: string | undefined;
}

/**
 * Corrige um binding **sem UPDATE manual e sem apagar histórico**.
 *
 * **O problema que este service resolve.** Até aqui, um vínculo errado
 * — a Identity apontando para o registro de outra pessoa — só podia ser
 * consertado com SQL na mão. Isso é inaceitável em dois níveis: não há
 * auditoria de quem corrigiu, quando e por quê; e a operação correta
 * (superar a antiga e ativar a nova) tem uma janela entre os dois passos
 * em que ou existem duas referências ACTIVE, ou nenhuma.
 *
 * **SUPERSEDED ≠ exclusão.** A referência antiga permanece na tabela,
 * inteira, com o `status` mudado e o `updated_at` carimbado. Ela deixa
 * de ser a resposta ACTIVE e nada mais. Apagar destruiria a evidência
 * de como o vínculo errado surgiu — que é justamente o que se quer
 * conservar quando o erro expôs dado de outra pessoa. Não existe, em
 * lugar nenhum deste módulo, um `DELETE` sobre
 * `identity_external_references`.
 *
 * **Ordem dentro da transação, e por que é essa:**
 *
 *   1. carrega a referência pelo `publicId`;
 *   2. `markSuperseded()` no Aggregate (recusa se já não estava ACTIVE);
 *   3. `repository.supersede()` — `UPDATE ... WHERE status = 'ACTIVE'`,
 *      compare-and-swap; zero linhas afetadas = alguém chegou primeiro;
 *   4. só ENTÃO, havendo substituição, o `INSERT` da nova.
 *
 * O passo 3 antes do 4 é o que garante que **em nenhum instante existem
 * duas referências ACTIVE** para `(identity, system, entity)` — nem
 * sequer dentro da transação, onde a UNIQUE KEY já as recusaria e
 * abortaria tudo. A transação garante o oposto também: se o `INSERT`
 * falhar, o supersede é desfeito e o vínculo antigo continua valendo.
 * Nunca se fica sem vínculo por causa de uma substituição malsucedida.
 *
 * **Cadeia de auditoria fechada.** O evento `.superseded` carrega
 * `replacedByPublicId`; o `.created` da nova referência carrega o
 * `causationId` apontando para o evento de supersede. Os dois
 * compartilham o mesmo `correlationId` — é uma operação só. Quem lê a
 * auditoria consegue percorrer a substituição nos dois sentidos sem
 * inferir nada por horário de gravação.
 */
export class SupersedeIdentityExternalReferenceService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly identityExternalReferenceRepositoryFactory: (
      connection: Queryable
    ) => IdentityExternalReferenceRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(
    request: SupersedeIdentityExternalReferenceRequest
  ): Promise<SupersedeIdentityExternalReferenceResult> {
    const referencePublicId = PublicId.fromString(request.referencePublicId);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const repository = this.identityExternalReferenceRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const existente = await repository.findByPublicId(referencePublicId);
      if (existente === undefined) {
        throw new IdentityExternalReferenceNotFoundByPublicIdError(referencePublicId.toString());
      }

      // A substituta é construída ANTES do supersede porque o evento de
      // supersede precisa citar o `publicId` dela — e porque qualquer
      // recusa de validação (matchMethod/legacyId inválidos) deve
      // acontecer antes de qualquer escrita, não no meio dela.
      const substituta =
        request.replacement === undefined
          ? undefined
          : IdentityExternalReference.create({
              identityPublicId: existente.getIdentityPublicId(),
              systemCode: existente.getSystemCode().toString(),
              entityType: existente.getEntityType().toString(),
              legacyId: request.replacement.legacyId,
              matchMethod: request.replacement.matchMethod,
              actorPublicId: request.actorPublicId,
              correlationId
            });

      existente.markSuperseded({
        reason: request.reason,
        actorPublicId: request.actorPublicId,
        correlationId,
        ...(substituta !== undefined ? { replacedByPublicId: substituta.getPublicId().toString() } : {})
      });

      await repository.supersede(existente);

      const eventosDeSupersede = existente.pullDomainEvents();
      await auditEventRepository.insertMany(eventosDeSupersede.map((evento) => AuditEvent.fromDomainEvent(evento)));

      if (substituta !== undefined) {
        // A chave de binding já está livre (a linha anterior tem
        // `active_binding_flag` NULL desde o UPDATE acima). Resta a
        // invariante da 0016: o registro legado de destino não pode já
        // pertencer a outra Identity.
        const registroJaVinculado = await repository.existsActiveBySystemCodeEntityTypeAndLegacyId(
          substituta.getSystemCode(),
          substituta.getEntityType(),
          substituta.getLegacyId()
        );
        if (registroJaVinculado) {
          throw new IdentityExternalReferenceAlreadyExistsError();
        }

        await repository.insert(substituta);

        const causationId = eventosDeSupersede[0]?.eventId;
        const eventosDeCriacao = substituta.pullDomainEvents().map((evento) =>
          causationId === undefined ? evento : { ...evento, causationId }
        );
        await auditEventRepository.insertMany(eventosDeCriacao.map((evento) => AuditEvent.fromDomainEvent(evento)));
      }

      return {
        supersededPublicId: existente.getPublicId().toString(),
        replacementPublicId: substituta?.getPublicId().toString()
      };
    });
  }
}
