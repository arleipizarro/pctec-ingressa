import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { ExistingConnectionUnitOfWork } from "../../../shared/database/ExistingConnectionUnitOfWork.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { OrganizationRelationshipParentNotFoundError } from "../domain/errors/OrganizationRelationshipErrors.js";
import {
  OrganizationParentNotActiveError,
  OrganizationParentOnlyForCompanyError
} from "../domain/errors/OrganizationProvisioningErrors.js";
import type { CreateOrganizationService } from "./CreateOrganizationService.js";
import type { CreateOrganizationRelationshipService } from "./CreateOrganizationRelationshipService.js";

export interface ProvisionOrganizationRequest {
  readonly type: string;
  readonly legalName: string;
  readonly tradeName?: string | undefined;
  /**
   * Associação inicial, OPCIONAL e só para `COMPANY`. Ausente significa
   * "empresa sem grupo" — estado legítimo, não cadastro pela metade.
   */
  readonly parentBusinessGroupPublicId?: string | undefined;
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface ProvisionOrganizationResult {
  readonly publicId: string;
  readonly type: string;
  readonly status: string;
  readonly version: number;
  /** `null` quando nenhuma associação foi pedida. */
  readonly relationshipPublicId: string | null;
}

/**
 * Cria uma Organization pela tela administrativa e, opcionalmente, já a
 * associa a um grupo empresarial — **as duas escritas na mesma
 * transação**.
 *
 * **Por que este serviço existe.** `CreateOrganizationService` e
 * `CreateOrganizationRelationshipService` abrem cada um o seu
 * `runInTransaction`, e `MariaDbUnitOfWork` não aninha: chamar um dentro
 * do outro pegaria outra conexão do pool e viraria uma segunda transação
 * independente. Se o relacionamento falhasse, a organização já estaria
 * comitada — órfã, sem grupo, e sem ninguém saber. É o estado parcial
 * que esta entrega proíbe.
 *
 * **Não reimplementa nenhuma regra.** Os dois serviços são chamados como
 * estão, recebendo `ExistingConnectionUnitOfWork` sobre a conexão desta
 * transação — o mesmo mecanismo que o APPLY do importador já usa. Assim
 * a unicidade de documento, as regras "parent é BUSINESS_GROUP" / "child
 * é COMPANY", a checagem de `uk_org_rel_child` e os eventos de auditoria
 * continuam morando num lugar só. Duplicar aqui daria duas cópias que
 * divergem no primeiro ajuste feito de um lado só.
 *
 * O que este serviço acrescenta são as duas regras que só existem por
 * causa da composição: grupo não pertence a grupo, e grupo inativo não
 * recebe empresa nova.
 *
 * **Nenhuma referência externa é criada.** Organização nascida aqui não
 * veio do Helpdesk nem do Portal; fabricar um
 * `OrganizationExternalReference` registraria um vínculo legado que não
 * existe. Nada é inferido de sistema de origem algum.
 *
 * **Nenhuma exclusão.** Este serviço só insere.
 */
export class ProvisionOrganizationService {
  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    /**
     * Fábricas, e não instâncias: cada serviço precisa ser construído
     * sobre a UnitOfWork DESTA transação. Recebê-los prontos os traria
     * amarrados ao `MariaDbUnitOfWork` do pool, que é exatamente o que
     * quebraria a atomicidade.
     */
    private readonly createOrganizationServiceFactory: (uow: UnitOfWork) => CreateOrganizationService,
    private readonly createOrganizationRelationshipServiceFactory: (
      uow: UnitOfWork
    ) => CreateOrganizationRelationshipService
  ) {}

  public async execute(request: ProvisionOrganizationRequest): Promise<ProvisionOrganizationResult> {
    // Formato antes de I/O — falha rápida, mesmo princípio de
    // `CreateOrganizationService`.
    const type = OrganizationType.create(request.type);
    const correlationId = request.correlationId ?? randomUUID();

    const parentInformado =
      request.parentBusinessGroupPublicId !== undefined &&
      request.parentBusinessGroupPublicId.trim().length > 0;

    // Grupo dentro de grupo não existe no modelo. Recusar aqui, antes de
    // abrir transação, evita gastar conexão com entrada já sabidamente
    // inválida.
    if (parentInformado && !type.isCompany()) {
      throw new OrganizationParentOnlyForCompanyError();
    }
    const parentPublicId = parentInformado
      ? PublicId.fromString(request.parentBusinessGroupPublicId as string)
      : undefined;

    return this.unitOfWork.runInTransaction(async (connection) => {
      const interna = new ExistingConnectionUnitOfWork(connection);
      const organizationRepository = this.organizationRepositoryFactory(connection);

      // O grupo é conferido ANTES de a organização ser inserida. Deixar
      // para o serviço de relacionamento descobrir funcionaria (o
      // rollback desfaz), mas gastaria um INSERT e um public_id para
      // saber algo que uma leitura já respondia.
      //
      // "Existe" e "é BUSINESS_GROUP" são reconferidos pelo próprio
      // `CreateOrganizationRelationshipService` — aqui a leitura serve
      // para a regra que só este serviço tem: grupo INATIVO não recebe
      // empresa nova, senão a empresa nasce ativa dentro de uma
      // estrutura morta, visível para ninguém.
      if (parentPublicId !== undefined) {
        const parent = await organizationRepository.findByPublicId(parentPublicId);
        if (parent === undefined) {
          throw new OrganizationRelationshipParentNotFoundError(parentPublicId.toString());
        }
        if (parent.getStatus() !== "ACTIVE") {
          throw new OrganizationParentNotActiveError();
        }
      }

      const organizacao = await this.createOrganizationServiceFactory(interna).execute({
        type: request.type,
        legalName: request.legalName,
        tradeName: request.tradeName,
        actorPublicId: request.actorPublicId,
        correlationId
      });

      let relationshipPublicId: string | null = null;
      if (parentPublicId !== undefined) {
        const vinculo = await this.createOrganizationRelationshipServiceFactory(interna).execute({
          parentOrganizationPublicId: parentPublicId.toString(),
          childOrganizationPublicId: organizacao.publicId,
          actorPublicId: request.actorPublicId,
          correlationId
        });
        relationshipPublicId = vinculo.publicId;
      }

      return {
        publicId: organizacao.publicId,
        type: organizacao.type,
        status: organizacao.status,
        version: organizacao.version,
        relationshipPublicId
      };
    });
  }
}
