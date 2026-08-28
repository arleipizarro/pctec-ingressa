import type { Queryable } from "../../../shared/database/Queryable.js";
import type { OrganizationRepository } from "../../organization/domain/OrganizationRepository.js";
import { PublicId } from "../../organization/domain/value-objects/PublicId.js";
import type { LinkPortalOrganizationReferenceService } from "../../organization/application/LinkPortalOrganizationReferenceService.js";
import type { OrganizationExternalReferenceRepository } from "../../organization/domain/OrganizationExternalReferenceRepository.js";
import { SystemCode } from "../../organization/domain/value-objects/SystemCode.js";
import { EntityType } from "../../organization/domain/value-objects/EntityType.js";
import {
  PORTAL_REFERENCE_ENTITY_TYPE,
  PORTAL_REFERENCE_SYSTEM_CODE
} from "../../organization/domain/value-objects/PortalReferenceCodes.js";
import { PortalReferenceAmbiguousError } from "../../organization/domain/errors/PortalOrganizationReferenceErrors.js";
import { isDomainError } from "../../../shared/http/mapDomainErrorToHttp.js";
import type { MatchPortalClientByDocumentService } from "./MatchPortalClientByDocumentService.js";
import type { PortalClientMatchStatus } from "../domain/PortalClientMatch.js";
import { maskCnpj } from "../domain/value-objects/PortalDocument.js";

/**
 * Estado da integração com o Portal DEPOIS de uma tentativa automática.
 *
 * Os quatro primeiros são os do matching, repetidos aqui porque a tela
 * mostra o mesmo vocabulário nos dois lugares. Os três últimos só
 * existem depois de uma escrita ter sido tentada:
 *
 * - `LINKED` — a referência foi criada agora;
 * - `ALREADY_LINKED` — já existia, idêntica; nada foi escrito;
 * - `NOT_A_COMPANY` — BUSINESS_GROUP não recebe vínculo próprio;
 * - `FAILED` — a fonte, o banco ou a regra do vínculo recusaram. A
 *   organização continua existindo e correta.
 */
export type PortalAutoLinkStatus =
  | PortalClientMatchStatus
  | "LINKED"
  | "ALREADY_LINKED"
  | "NOT_A_COMPANY"
  | "FAILED";

export interface PortalAutoLinkResult {
  readonly status: PortalAutoLinkStatus;
  /** Preenchido só em `LINKED`/`ALREADY_LINKED`. */
  readonly legacyId: number | null;
  readonly referencePublicId: string | null;
  /** Nome do cliente do Portal correspondente, quando houve um. */
  readonly clientName: string | null;
  /** SEMPRE mascarado. O documento inteiro não sai desta camada. */
  readonly clientDocumentMasked: string | null;
  /** Quantos clientes do Portal têm o mesmo CNPJ — o que separa único de ambíguo. */
  readonly candidateCount: number;
  /** Código estável da recusa em `FAILED`. Nunca a mensagem crua de um driver. */
  readonly reasonCode: string | null;
}

/** Código genérico para falhas que não são recusa de domínio. */
export const PORTAL_AUTO_LINK_SOURCE_ERROR = "PORTAL_CATALOG_SOURCE_ERROR";

/**
 * Correspondência automática por CNPJ, e vínculo SOMENTE quando ela é
 * exata e única.
 *
 * ## Onde este serviço roda
 *
 * **Depois** de a Organization existir e estar comitada — na criação
 * manual pela tela e na reconciliação em lote. Nunca dentro da
 * transação que cria a organização, e isso é a regra central desta
 * fatia: o Portal é um banco de fora, e uma indisponibilidade dele não
 * pode desfazer um cadastro que já é válido. A empresa nasce; o vínculo
 * é uma segunda decisão, que pode ficar pendente.
 *
 * ## Ele não escreve nada por conta própria
 *
 * A escrita é inteiramente do `LinkPortalOrganizationReferenceService`
 * — com o `SELECT ... FOR UPDATE` na Organization, a releitura depois
 * do bloqueio, a idempotência, o `PORTAL_REFERENCE_AMBIGUOUS` e a
 * auditoria oficial dele. Este serviço só decide **se** e **com qual
 * `legacyId`** chamar. Reimplementar aqui qualquer parte daquilo
 * criaria um segundo caminho de escrita sem o bloqueio, que é
 * exatamente o buraco que o PR anterior fechou.
 *
 * ## O vínculo existente tem precedência sobre o matching
 *
 * Antes de perguntar qualquer coisa à fonte, este serviço lê as
 * referências `PCTEC_PORTAL`/`clientes` ACTIVE que a organização já
 * tem. Uma organização já vinculada é um FATO do Ingressa, e ele não
 * depende do CNPJ estar cadastrado aqui nem de o cliente continuar
 * ativo lá: perguntar ao Portal primeiro fazia uma empresa vinculada e
 * sem CNPJ ser reportada como `DOCUMENT_MISSING_OR_INVALID`, e uma
 * empresa vinculada cujo cliente foi desativado no Portal ser reportada
 * como `INACTIVE_ONLY` — os dois convidando a "resolver" um vínculo que
 * já existe e está correto.
 *
 * A leitura é uma consulta comum, fora de transação, e ela NÃO decide
 * escrita nenhuma: no caminho `ALREADY_LINKED` nada é escrito, e no
 * caminho "nenhuma referência" quem decide continua sendo o
 * `LinkPortalOrganizationReferenceService`, que relê sob o
 * `SELECT ... FOR UPDATE`. Por isso ela não enfraquece a atomicidade —
 * uma referência criada por um concorrente entre esta leitura e aquele
 * bloqueio é vista lá, e a recusa correta (`alreadyLinked` ou
 * `PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT`) continua saindo de lá.
 *
 * Mais de uma ACTIVE é o estado ambíguo que o CLI genérico ainda
 * alcança: recusar com `PORTAL_REFERENCE_AMBIGUOUS` é a única saída que
 * não escolhe por conta própria — e é por isso que a leitura é a lista
 * inteira, nunca um `LIMIT 1`.
 *
 * ## Fail-closed em todos os eixos
 *
 * - já vinculada → **não consulta a fonte** e **não chama** o vínculo;
 * - matching não-único → **não chama** o serviço de vínculo;
 * - BUSINESS_GROUP → **não chama**, e nem consulta a fonte;
 * - erro de qualquer natureza → resultado `FAILED` com código, e a
 *   organização segue intacta. Nada é inventado, nada é apagado.
 */
export class AutoLinkPortalOrganizationReferenceService {
  private readonly systemCode = SystemCode.create(PORTAL_REFERENCE_SYSTEM_CODE);
  private readonly entityType = EntityType.create(PORTAL_REFERENCE_ENTITY_TYPE);

  public constructor(
    private readonly organizationRepositoryFactory: (connection: Queryable) => OrganizationRepository,
    private readonly connection: Queryable,
    private readonly matchService: MatchPortalClientByDocumentService,
    private readonly linkService: LinkPortalOrganizationReferenceService,
    /**
     * Leitura das referências que a organização JÁ tem. O mesmo
     * contrato de domínio que a leitura administrativa e o serviço de
     * vínculo usam — nenhum SQL próprio nasce aqui.
     */
    private readonly organizationExternalReferenceRepositoryFactory: (
      connection: Queryable
    ) => OrganizationExternalReferenceRepository
  ) {}

  public async execute(request: {
    readonly organizationPublicId: string;
    readonly actorPublicId: string;
    readonly correlationId?: string | undefined;
  }): Promise<PortalAutoLinkResult> {
    try {
      const publicId = PublicId.fromString(request.organizationPublicId);
      const organizacao = await this.organizationRepositoryFactory(this.connection).findByPublicId(publicId);
      if (organizacao === undefined) {
        return falha("PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND");
      }
      // Grupo nunca tem `clientes.id` próprio. Sair aqui evita ir à
      // fonte para descobrir algo que o modelo já responde.
      if (organizacao.getType().isBusinessGroup()) {
        return { ...vazio(), status: "NOT_A_COMPANY" };
      }

      // Vínculo existente ANTES da fonte: já vinculada é um fato do
      // Ingressa, e ele não depende do CNPJ nem da situação atual do
      // cliente no Portal.
      const ativas = await this.organizationExternalReferenceRepositoryFactory(
        this.connection
      ).findAllActiveByOrganizationSystemCodeAndEntityType(publicId, this.systemCode, this.entityType);
      if (ativas.length > 1) {
        // Recusar, nunca escolher: qual das duas citar já seria a
        // escolha que este erro existe para não fazer.
        throw new PortalReferenceAmbiguousError(publicId.toString(), ativas.length);
      }
      const jaVinculada = ativas[0];
      if (jaVinculada !== undefined) {
        return {
          status: "ALREADY_LINKED",
          legacyId: jaVinculada.getLegacyId().toNumber(),
          referencePublicId: jaVinculada.getPublicId().toString(),
          // A fonte não foi consultada: afirmar nome ou documento aqui
          // seria inventar o que ninguém perguntou.
          clientName: null,
          clientDocumentMasked: null,
          candidateCount: 0,
          reasonCode: null
        };
      }

      const documento = organizacao.getDocumentNumber()?.normalized();
      const correspondencia = await this.matchService.execute(documento);

      if (correspondencia.status !== "EXACT_UNIQUE" || correspondencia.client === undefined) {
        return {
          ...vazio(),
          status: correspondencia.status,
          candidateCount: correspondencia.candidateCount
        };
      }

      const cliente = correspondencia.client;
      const vinculo = await this.linkService.execute({
        organizationPublicId: publicId.toString(),
        legacyId: cliente.id,
        actorPublicId: request.actorPublicId,
        correlationId: request.correlationId
      });

      return {
        status: vinculo.alreadyLinked ? "ALREADY_LINKED" : "LINKED",
        legacyId: vinculo.legacyId,
        referencePublicId: vinculo.publicId,
        clientName: cliente.nome,
        clientDocumentMasked: maskCnpj(cliente.documentDigits),
        candidateCount: 1,
        reasonCode: null
      };
    } catch (erro) {
      // Recusa de domínio traz um código estável e uma mensagem já
      // segura; qualquer outra coisa vira um código genérico. Em
      // nenhum dos dois casos a mensagem original sobe: ela pode
      // carregar host, usuário de banco ou SQL.
      return falha(isDomainError(erro) ? erro.code : PORTAL_AUTO_LINK_SOURCE_ERROR);
    }
  }
}

function vazio(): PortalAutoLinkResult {
  return {
    status: "NOT_FOUND",
    legacyId: null,
    referencePublicId: null,
    clientName: null,
    clientDocumentMasked: null,
    candidateCount: 0,
    reasonCode: null
  };
}

function falha(reasonCode: string): PortalAutoLinkResult {
  return { ...vazio(), status: "FAILED", reasonCode };
}
