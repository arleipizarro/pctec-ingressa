import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { OrganizationNotFoundError } from "../domain/errors/OrganizationErrors.js";

export interface RenameOrganizationRequest {
  readonly organizationPublicId: string;
  readonly legalName: string;
  /** `undefined` = manter o nome fantasia; `null` = limpar. */
  readonly tradeName: string | null | undefined;
  readonly expectedVersion: number;
  /** Derivado da SESSÃO pelo controlador — nunca do corpo. */
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface RenameOrganizationResult {
  readonly publicId: string;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly version: number;
  /** `false` quando o texto enviado era idêntico ao que já estava lá. */
  readonly changed: boolean;
  readonly changedFields: readonly string[];
}

/**
 * Correção administrativa de razão social e nome fantasia.
 *
 * Primeiro comando de mutação de `Organization` da base. O escopo é
 * estreito por decisão, não por falta de tempo: `type`, `status`,
 * `documentNumber` e referências externas continuam sem caminho de
 * alteração, porque cada um deles muda o significado da organização
 * para quem já depende dela. Nome é a única correção que não reescreve
 * autorização nenhuma.
 *
 * Toda a regra vive no Aggregate (`Organization.rename`): a checagem de
 * versão, a validação dos nomes, a decisão de "nada mudou" e a emissão
 * do evento. Este serviço orquestra transação, repositório e trilha —
 * e é isso que permite ao controlador HTTP não conhecer nenhuma delas.
 *
 * A auditoria sai do MESMO commit da escrita: um nome corrigido sem
 * evento que o explique é indistinguível de um nome que sempre foi
 * aquele.
 */
export class RenameOrganizationService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    private readonly auditEventRepositoryFactory: (connection: Queryable) => AuditEventRepository
  ) {}

  public async execute(request: RenameOrganizationRequest): Promise<RenameOrganizationResult> {
    // Formato do publicId antes de qualquer I/O — mesmo princípio de
    // `CreateOrganizationService`.
    const publicId = PublicId.fromString(request.organizationPublicId);
    const correlationId = request.correlationId ?? randomUUID();

    return this.unitOfWork.runInTransaction(async (connection) => {
      const organizationRepository = this.organizationRepositoryFactory(connection);
      const auditEventRepository = this.auditEventRepositoryFactory(connection);

      const organization = await organizationRepository.findByPublicId(publicId);
      if (organization === undefined) {
        throw new OrganizationNotFoundError(publicId.toString());
      }

      // Versão capturada ANTES da mutação: é ela que vai para o `WHERE`
      // do UPDATE. Derivá-la depois (`getVersion() - 1`) daria no mesmo
      // hoje e passaria a mentir no dia em que uma transição bumpar
      // diferente — mesmo padrão de `ActivateFederatedIdentityService`.
      const versaoOriginal = organization.getVersion();

      organization.rename({
        legalName: request.legalName,
        tradeName: request.tradeName,
        expectedVersion: request.expectedVersion,
        actorPublicId: request.actorPublicId,
        correlationId
      });

      const eventos = organization.pullDomainEvents();
      if (eventos.length === 0) {
        // Nada mudou: nenhum UPDATE, nenhuma versão nova, nenhuma
        // auditoria. Salvar o mesmo texto duas vezes não é correção, e
        // uma trilha cheia de eventos vazios esconde os que importam.
        return {
          publicId: organization.getPublicId().toString(),
          legalName: organization.getLegalName().toString(),
          tradeName: organization.getTradeName()?.toString() ?? null,
          version: versaoOriginal,
          changed: false,
          changedFields: []
        };
      }

      await organizationRepository.update(organization, versaoOriginal);
      await auditEventRepository.insertMany(eventos.map((evento) => AuditEvent.fromDomainEvent(evento)));

      return {
        publicId: organization.getPublicId().toString(),
        legalName: organization.getLegalName().toString(),
        tradeName: organization.getTradeName()?.toString() ?? null,
        version: organization.getVersion(),
        changed: true,
        changedFields: eventos.flatMap((evento) =>
          evento.eventType === "organization.updated" ? [...evento.payload.changedFields] : []
        )
      };
    });
  }
}
