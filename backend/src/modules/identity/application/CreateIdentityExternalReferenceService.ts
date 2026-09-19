import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { IdentityRepository } from "../domain/IdentityRepository.js";
import type { IdentityExternalReferenceRepository } from "../domain/IdentityExternalReferenceRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import { LegacyId } from "../domain/value-objects/LegacyId.js";
import {
  IdentityExternalReferenceIdentityNotFoundError,
  IdentityExternalReferenceAlreadyExistsError,
  IdentityExternalReferenceBindingAlreadyExistsError
} from "../domain/errors/IdentityExternalReferenceErrors.js";

export interface CreateIdentityExternalReferenceRequest {
  readonly identityPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: string | number;
  readonly matchMethod: string;
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface CreateIdentityExternalReferenceResult {
  readonly publicId: string;
  readonly identityPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly matchMethod: string;
  readonly status: string;
}

/**
 * Application Service para o comando CreateIdentityExternalReference.
 *
 * Orquestra: confirmar que a Identity referenciada existe
 * (`IDENTITY_NOT_FOUND`), checar a invariante "no máximo 1 referência
 * ACTIVE por (systemCode, entityType, legacyId)" via repositório antes
 * do INSERT (`IDENTITY_EXTERNAL_REFERENCE_ALREADY_EXISTS` — checagem
 * otimista, fast fail com mensagem amigável), construir o Aggregate,
 * persistir, e gravar o evento de auditoria
 * (`identity-external-reference.created`) — tudo na mesma transação.
 *
 * **A garantia real sob concorrência não é esta checagem otimista** —
 * é a `UNIQUE KEY uk_id_ext_ref_active_match` sobre a coluna gerada
 * `active_match_key` (migration 0016); se a checagem otimista perder
 * uma corrida, o INSERT ainda falha no banco e
 * `MariaDbIdentityExternalReferenceRepository` traduz o erro de volta
 * para o mesmo erro de domínio. Ver raciocínio completo em 0016.
 *
 * **`matchMethod` é obrigatório e nunca inferido automaticamente.**
 * Quem decide é sempre o chamador (futuro CLI, Fatia 3) — este service
 * é um comando de criação simples, não um processo de matching.
 * Valores aceitos: `MATCHED_BY_EMAIL`, `MATCHED_MANUAL_CONFIRMED`.
 * Resultados de processo (UNMATCHED, AMBIGUOUS, INVALID_EMAIL) nunca
 * chegam aqui — são devolvidos pelo processo de bootstrap sem inserção.
 *
 * **Duas invariantes, não uma** (a segunda acrescentada com a migration
 * 0024, fundação PCTEC Meu RH):
 *
 * - `uk_id_ext_ref_active_match` (0016) — um registro legado nunca é
 *   reivindicado por duas Identities;
 * - `uk_id_ext_ref_active_binding` (0024) — uma Identity nunca
 *   representa dois registros no mesmo sistema/entidade.
 *
 * As duas são checadas aqui de forma otimista, cada uma com seu erro de
 * domínio próprio, e as duas são garantidas de verdade pelo banco.
 *
 * Referências `SUPERSEDED` NUNCA contam para nenhuma das duas — várias
 * linhas históricas coexistem livremente; só uma `ACTIVE` por vez é a
 * invariante. É isso que torna a correção de um vínculo errado um
 * SUPERSEDE, e nunca um DELETE.
 */
export class CreateIdentityExternalReferenceService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly identityRepositoryFactory: (connection: Queryable) => IdentityRepository,
    private readonly identityExternalReferenceRepositoryFactory: (
      connection: Queryable
    ) => IdentityExternalReferenceRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(
    request: CreateIdentityExternalReferenceRequest
  ): Promise<CreateIdentityExternalReferenceResult> {
    const identityPublicId = PublicId.fromString(request.identityPublicId);
    const systemCode = SystemCode.create(request.systemCode);
    const entityType = EntityType.create(request.entityType);
    const legacyId = LegacyId.create(request.legacyId);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const identityRepository = this.identityRepositoryFactory(connection);
      const identityExternalReferenceRepository = this.identityExternalReferenceRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const identity = await identityRepository.findByPublicId(identityPublicId);
      if (identity === undefined) {
        throw new IdentityExternalReferenceIdentityNotFoundError(identityPublicId.toString());
      }

      const alreadyExists = await identityExternalReferenceRepository.existsActiveBySystemCodeEntityTypeAndLegacyId(
        systemCode,
        entityType,
        legacyId
      );
      if (alreadyExists) {
        throw new IdentityExternalReferenceAlreadyExistsError();
      }

      // Invariante SIMÉTRICA (migration 0024): a Identity não pode já
      // representar OUTRO registro neste mesmo sistema/entidade.
      // Checagem otimista, como a de cima — a garantia real sob
      // concorrência é `uk_id_ext_ref_active_binding`, e o repositório
      // traduz a violação de volta para este mesmo erro de domínio.
      const bindingAlreadyExists = await identityExternalReferenceRepository.findActiveByIdentityAndSystemCodeAndEntityType(
        identityPublicId.toString(),
        systemCode,
        entityType
      );
      if (bindingAlreadyExists !== undefined) {
        throw new IdentityExternalReferenceBindingAlreadyExistsError();
      }

      const reference = IdentityExternalReference.create({
        identityPublicId: identityPublicId.toString(),
        systemCode: request.systemCode,
        entityType: request.entityType,
        legacyId: request.legacyId,
        matchMethod: request.matchMethod,
        actorPublicId: request.actorPublicId,
        correlationId
      });

      await identityExternalReferenceRepository.insert(reference);

      const events = reference.pullDomainEvents();
      const auditEvents = events.map((event) => AuditEvent.fromDomainEvent(event));
      await auditEventRepository.insertMany(auditEvents);

      return {
        publicId: reference.getPublicId().toString(),
        identityPublicId: reference.getIdentityPublicId(),
        systemCode: reference.getSystemCode().toString(),
        entityType: reference.getEntityType().toString(),
        matchMethod: reference.getMatchMethod().toString(),
        status: reference.getStatus()
      };
    });
  }
}
