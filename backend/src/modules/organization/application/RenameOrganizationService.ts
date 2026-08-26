import { randomUUID } from "node:crypto";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { OrganizationNotFoundError } from "../domain/errors/OrganizationErrors.js";

export interface RenameOrganizationRequest {
  readonly organizationPublicId: string;
  readonly legalName: string;
  /**
   * `undefined` mantém o nome fantasia atual; `null` ou string vazia o
   * limpam; um texto o substitui. A distinção existe para que corrigir a
   * razão social não apague o nome fantasia por omissão.
   */
  readonly tradeName?: string | null | undefined;
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly actorPublicId: string;
  readonly expectedVersion: number;
  readonly correlationId?: string | undefined;
}

export interface RenameOrganizationResult {
  readonly publicId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly version: number;
  readonly changed: boolean;
  readonly changedFields: readonly string[];
}

/**
 * Corrige os nomes de uma organização — razão social e nome fantasia.
 *
 * **Correção de cadastro, não sincronização.** Alterar o nome aqui não
 * toca o Helpdesk nem o Portal: as `OrganizationExternalReference`
 * continuam apontando para os mesmos registros de origem, e o nome de lá
 * permanece como está. Quem precisar dos dois iguais precisa corrigir os
 * dois — e a UI diz isso.
 *
 * **Só nomes.** `type`, `documentNumber`, `status`, memberships,
 * `ApplicationAccess` e referências externas não são tocados por este
 * caso de uso, nem como efeito colateral.
 *
 * **Sem mudança real, sem escrita.** O agregado não emite evento nem
 * incrementa versão quando os valores submetidos são iguais aos atuais;
 * aqui isso vira `changed: false` e nenhum `UPDATE`. Gastar uma versão à
 * toa faria a próxima escrita de outra pessoa falhar por conflito sem
 * motivo.
 */
export class RenameOrganizationService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: RenameOrganizationRequest): Promise<RenameOrganizationResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const organizationPublicId = PublicId.fromString(request.organizationPublicId);

    return this.unitOfWork.runInTransaction(async (connection) => {
      const organizationRepository = this.organizationRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const organizacao = await organizationRepository.findByPublicId(organizationPublicId);
      if (organizacao === undefined) {
        throw new OrganizationNotFoundError(organizationPublicId.toString());
      }

      const versaoOriginal = organizacao.getVersion();
      organizacao.rename({
        legalName: request.legalName,
        ...(request.tradeName === undefined ? {} : { tradeName: request.tradeName }),
        actorPublicId: request.actorPublicId,
        expectedVersion: request.expectedVersion,
        correlationId
      });

      const eventos = organizacao.pullDomainEvents();
      const mudou = eventos.length > 0;

      if (mudou) {
        await organizationRepository.update(organizacao, versaoOriginal);
        await auditEventRepository.insertMany(eventos.map((evento) => AuditEvent.fromDomainEvent(evento)));
      }

      const alterados = mudou
        ? ((eventos[0]?.payload as { changedFields?: readonly string[] }).changedFields ?? [])
        : [];

      return {
        publicId: organizationPublicId.toString(),
        legalName: organizacao.getLegalName().toString(),
        tradeName: organizacao.getTradeName()?.toString() ?? null,
        version: organizacao.getVersion(),
        changed: mudou,
        changedFields: alterados
      };
    });
  }
}
