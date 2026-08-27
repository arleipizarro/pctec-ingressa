import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { ExistingConnectionUnitOfWork } from "../../../shared/database/ExistingConnectionUnitOfWork.js";
import type { OrganizationLockRepository } from "../domain/OrganizationLockRepository.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import type { CreateOrganizationExternalReferenceService } from "./CreateOrganizationExternalReferenceService.js";
import { PublicId } from "../domain/value-objects/PublicId.js";
import { SystemCode } from "../domain/value-objects/SystemCode.js";
import { EntityType } from "../domain/value-objects/EntityType.js";
import {
  PORTAL_REFERENCE_ENTITY_TYPE,
  PORTAL_REFERENCE_SYSTEM_CODE
} from "../domain/value-objects/PortalReferenceCodes.js";
import {
  PortalReferenceAlreadyLinkedDifferentError,
  PortalReferenceAmbiguousError,
  PortalReferenceCompanyRequiredError,
  PortalReferenceLegacyIdInvalidError,
  PortalReferenceOrganizationNotActiveError,
  PortalReferenceOrganizationNotFoundError
} from "../domain/errors/PortalOrganizationReferenceErrors.js";

export interface LinkPortalOrganizationReferenceRequest {
  readonly organizationPublicId: string;
  /** Cru, como chegou do corpo da requisição — validado aqui, nunca presumido inteiro. */
  readonly legacyId: unknown;
  /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
  readonly actorPublicId: string;
  readonly correlationId?: string | undefined;
}

export interface LinkPortalOrganizationReferenceResult {
  readonly publicId: string;
  readonly organizationPublicId: string;
  readonly systemCode: string;
  readonly entityType: string;
  readonly legacyId: number;
  readonly status: string;
  /**
   * `true` quando a referência JÁ existia, idêntica, e nada foi escrito.
   *
   * Quem chama usa isto para responder 200 em vez de 201 — e para não
   * anunciar como novidade um vínculo que já estava lá.
   */
  readonly alreadyLinked: boolean;
}

/**
 * Caso de uso: vincular uma COMPANY ao Portal —
 * `OrganizationExternalReference(PCTEC_PORTAL, clientes, legacyId)`.
 *
 * É a operação que substitui o CLI `bootstrap-organization-external-reference`
 * no dia a dia. O CLI continua existindo e continua correto; o que muda é
 * que a operação normal deixa de exigir acesso ao Linux do servidor.
 *
 * ## A regra que este serviço protege
 *
 * **Uma COMPANY tem no máximo UMA referência ACTIVE de
 * `PCTEC_PORTAL`/`clientes`.**
 *
 * Essa regra NÃO é a UNIQUE KEY da migration 0013. Aquela cobre
 * `(system_code, entity_type, legacy_id)` — impede duas organizações de
 * reivindicarem o mesmo `clientes.id`, e é por isso que ela continua
 * sendo a autoridade daquele conflito. Ela **não** impede a mesma
 * organização de ganhar duas referências ACTIVE com `legacyId`
 * diferentes, que era exatamente o buraco desta operação: dois pedidos
 * simultâneos liam "não existe nenhuma" e ambos criavam.
 *
 * Criar uma restrição global sobre `(organization_public_id,
 * system_code, entity_type)` resolveria a corrida e proibiria, de
 * quebra, mapeamentos muitos-para-um legítimos de outros sistemas — que
 * o modelo permite de propósito. A regra é desta OPERAÇÃO, então é aqui
 * que ela é imposta.
 *
 * ## Como a atomicidade é garantida
 *
 * Tudo numa transação só, aberta por este serviço:
 *
 * 1. `SELECT ... FOR UPDATE` na linha da **Organization**. É o único
 *    registro que já existe antes da escrita e que todos os concorrentes
 *    daquela empresa têm em comum. O InnoDB serializa aí — e só ali:
 *    empresas diferentes não esperam umas pelas outras. Vale entre
 *    processos Node, entre réplicas e entre o CLI e a API, porque quem
 *    serializa é o banco, não a memória de um processo;
 * 2. **depois** de obter o bloqueio, a leitura das referências ACTIVE.
 *    A ordem importa: um `SELECT ... FOR UPDATE` não é leitura
 *    consistente e não fixa o snapshot da transação, então a leitura
 *    seguinte enxerga o que o concorrente comitou enquanto esperávamos;
 * 3. a escrita, pelo `CreateOrganizationExternalReferenceService` —
 *    montado sobre `ExistingConnectionUnitOfWork`, para participar
 *    DESTA transação em vez de abrir outra. Aggregate, evento de domínio
 *    e auditoria continuam sendo os oficiais, sem cópia.
 *
 * Duas requisições simultâneas para a mesma COMPANY com `legacyId`
 * diferentes: a primeira cria; a segunda espera no bloqueio, relê, vê a
 * referência recém-criada e recusa com 409. Exatamente uma escrita,
 * exatamente um evento de auditoria.
 *
 * ## Decisões
 *
 * - `legacyId` inteiro positivo — `PORTAL_REFERENCE_LEGACY_ID_INVALID`;
 * - organização existe — `PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND` (404);
 * - é COMPANY — `PORTAL_REFERENCE_COMPANY_REQUIRED`;
 * - está ACTIVE — `PORTAL_REFERENCE_ORGANIZATION_NOT_ACTIVE`;
 * - **mais de uma referência ACTIVE** — `PORTAL_REFERENCE_AMBIGUOUS`
 *   (409). Estado que o CLI genérico ainda alcança; recusar é a única
 *   saída que não escolhe por conta própria;
 * - já vinculada ao MESMO `legacyId` → devolve a existente,
 *   `alreadyLinked: true`, **sem escrever e sem gerar evento novo**;
 * - já vinculada a OUTRO `legacyId` → `PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT`
 *   (409), sem sobrescrever;
 * - `legacyId` de outra organização → o
 *   `ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS` (409) do serviço
 *   oficial sobe intacto. Aquela invariante é global e continua sendo
 *   dele.
 *
 * ## Nada de revogar, trocar ou excluir
 *
 * Não há caminho para isso aqui, e não é esquecimento. O modelo marca
 * referências antigas como `SUPERSEDED`, mas nenhum comando de domínio
 * faz essa transição; implementá-la por este PR significaria inventar a
 * regra de sucessão junto com a tela que a usa.
 */
export class LinkPortalOrganizationReferenceService {
  private readonly systemCode = SystemCode.create(PORTAL_REFERENCE_SYSTEM_CODE);
  private readonly entityType = EntityType.create(PORTAL_REFERENCE_ENTITY_TYPE);

  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly organizationLockRepositoryFactory: (connection: Queryable) => OrganizationLockRepository,
    private readonly organizationExternalReferenceRepositoryFactory: (
      connection: Queryable
    ) => OrganizationExternalReferenceRepository,
    /**
     * Fábrica, não instância: o serviço oficial precisa nascer sobre a
     * UnitOfWork DESTA transação. Recebê-lo pronto o traria amarrado ao
     * pool — e seria de novo uma segunda transação, que é a origem do
     * defeito que este desenho corrige.
     */
    private readonly createOrganizationExternalReferenceServiceFactory: (
      uow: UnitOfWork
    ) => CreateOrganizationExternalReferenceService
  ) {}

  public async execute(
    request: LinkPortalOrganizationReferenceRequest
  ): Promise<LinkPortalOrganizationReferenceResult> {
    // Formato antes de qualquer I/O: um corpo inválido não merece
    // transação nem bloqueio.
    const legacyId = normalizarLegacyId(request.legacyId);
    const organizationPublicId = PublicId.fromString(request.organizationPublicId);

    return this.unitOfWork.runInTransaction(async (connection) => {
      const lockRepository = this.organizationLockRepositoryFactory(connection);
      const referenceRepository = this.organizationExternalReferenceRepositoryFactory(connection);

      // (1) Serializa os concorrentes DESTA organização. A partir daqui,
      // ninguém mais escreve o vínculo dela até o COMMIT.
      const organization = await lockRepository.lockByPublicId(organizationPublicId);
      if (organization === undefined) {
        throw new PortalReferenceOrganizationNotFoundError(organizationPublicId.toString());
      }
      if (organization.getType().isBusinessGroup()) {
        throw new PortalReferenceCompanyRequiredError();
      }
      if (!organization.isActive()) {
        throw new PortalReferenceOrganizationNotActiveError();
      }

      // (2) Releitura DEPOIS do bloqueio — e sem `LIMIT 1`, porque
      // "quantas existem" é parte da decisão.
      const ativas = await referenceRepository.findAllActiveByOrganizationSystemCodeAndEntityType(
        organizationPublicId,
        this.systemCode,
        this.entityType
      );
      if (ativas.length > 1) {
        throw new PortalReferenceAmbiguousError(organizationPublicId.toString(), ativas.length);
      }

      const existente = ativas[0];
      if (existente !== undefined) {
        if (existente.getLegacyId().toNumber() !== legacyId) {
          throw new PortalReferenceAlreadyLinkedDifferentError();
        }
        return {
          publicId: existente.getPublicId().toString(),
          organizationPublicId: organizationPublicId.toString(),
          systemCode: PORTAL_REFERENCE_SYSTEM_CODE,
          entityType: PORTAL_REFERENCE_ENTITY_TYPE,
          legacyId,
          status: existente.getStatus(),
          alreadyLinked: true
        };
      }

      // (3) Escrita pelo serviço oficial, DENTRO desta transação.
      const criada = await this.createOrganizationExternalReferenceServiceFactory(
        new ExistingConnectionUnitOfWork(connection)
      ).execute({
        organizationPublicId: organizationPublicId.toString(),
        systemCode: PORTAL_REFERENCE_SYSTEM_CODE,
        entityType: PORTAL_REFERENCE_ENTITY_TYPE,
        legacyId,
        actorPublicId: request.actorPublicId,
        correlationId: request.correlationId
      });

      return {
        publicId: criada.publicId,
        organizationPublicId: criada.organizationPublicId,
        systemCode: criada.systemCode,
        entityType: criada.entityType,
        legacyId,
        status: criada.status,
        alreadyLinked: false
      };
    });
  }
}

/**
 * "Inteiro positivo" no sentido estrito.
 *
 * `Number("12abc")` é `NaN` e `Number(" 12 ")` é `12`, mas `Number("")`
 * e `Number(null)` são `0` — aceitar a conversão frouxa deixaria um
 * corpo vazio virar zero e cair só lá no Value Object, com outro código
 * de erro. A checagem textual recusa antes, com o código que a tela
 * conhece.
 */
function normalizarLegacyId(bruto: unknown): number {
  if (typeof bruto === "number") {
    if (!Number.isInteger(bruto) || bruto <= 0) {
      throw new PortalReferenceLegacyIdInvalidError();
    }
    return bruto;
  }
  if (typeof bruto === "string" && /^[1-9][0-9]*$/.test(bruto.trim())) {
    const numero = Number(bruto.trim());
    if (Number.isSafeInteger(numero)) {
      return numero;
    }
  }
  throw new PortalReferenceLegacyIdInvalidError();
}
