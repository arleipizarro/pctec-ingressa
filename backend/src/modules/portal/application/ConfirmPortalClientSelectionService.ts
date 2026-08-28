import type { PortalClientCatalogReader } from "../domain/PortalClientCatalogPort.js";
import type {
  LinkPortalOrganizationReferenceResult,
  LinkPortalOrganizationReferenceService
} from "../../organization/application/LinkPortalOrganizationReferenceService.js";
import {
  PortalCatalogClientInactiveError,
  PortalCatalogClientNotFoundError,
  PortalCatalogLegacyIdInvalidError
} from "../domain/errors/PortalCatalogErrors.js";
import { maskCnpj } from "../domain/value-objects/PortalDocument.js";

export interface ConfirmPortalClientSelectionResult extends LinkPortalOrganizationReferenceResult {
  /** Nome do cliente **relido da fonte**, nunca o que o navegador mandou. */
  readonly clientName: string;
  /** SEMPRE mascarado. O documento inteiro não sai desta camada. */
  readonly clientDocumentMasked: string | null;
}

/**
 * Confirmação de um cliente escolhido no catálogo — **com releitura
 * obrigatória da fonte**.
 *
 * ## Por que existe um segundo caminho de vínculo
 *
 * `POST /admin/organizations/:publicId/portal-reference` (PR #19)
 * continua existindo e continua correto: ele é o **vínculo operacional
 * por identificador conhecido**, para quem já sabe o `clientes.id` e
 * precisa vincular mesmo com o catálogo indisponível. Ele não consulta
 * o Portal, e é justamente isso que o mantém utilizável quando a fonte
 * está fora.
 *
 * Este serviço é o **vínculo confirmado a partir do catálogo**, e a
 * diferença não é de conveniência: quando o `legacyId` veio de uma
 * lista que a própria API montou, aceitar de volta o número sem
 * reconferir é confiar na resposta anterior como se fosse autoridade.
 * Entre a busca e o clique existe uma janela — o cliente pode ser
 * desativado ou removido no Portal — e é nessa janela que um vínculo
 * irreversível seria criado para um cadastro que já não serve.
 *
 * Então, imediatamente antes de escrever:
 *
 * 1. o cliente é **relido pelo `legacyId`** na fonte;
 * 2. inexistente → `PORTAL_CATALOG_CLIENT_NOT_FOUND`;
 * 3. inativo → `PORTAL_CATALOG_CLIENT_INACTIVE`;
 * 4. só então o serviço oficial de vínculo é chamado.
 *
 * ## O que o navegador pode mandar
 *
 * **Só o `legacyId`.** Nome, CNPJ, status e qualquer outro dado
 * comercial que venham no corpo são ignorados — não há um campo sequer
 * onde eles caibam neste contrato. O que a resposta devolve sobre o
 * cliente vem da releitura, não do pedido: assim a tela não consegue
 * "confirmar" um cliente descrevendo-o do jeito que lhe convém.
 *
 * `systemCode` e `entityType` seguem fixos no servidor, como no PR #19.
 *
 * ## O que este serviço NÃO faz
 *
 * Não escreve. A escrita é inteiramente do
 * `LinkPortalOrganizationReferenceService` — `SELECT ... FOR UPDATE` na
 * Organization, releitura das referências depois do bloqueio,
 * idempotência, `PORTAL_REFERENCE_AMBIGUOUS`, conflito quando o
 * `legacyId` pertence a outra empresa, auditoria oficial, ator da
 * sessão e `correlationId`. Este serviço decide se a escolha é legítima
 * **agora**; quem a transforma em referência é ele.
 */
export class ConfirmPortalClientSelectionService {
  public constructor(
    private readonly catalog: PortalClientCatalogReader,
    private readonly linkService: LinkPortalOrganizationReferenceService
  ) {}

  public async execute(request: {
    readonly organizationPublicId: string;
    /** Cru, como chegou do corpo — validado aqui, nunca presumido inteiro. */
    readonly legacyId: unknown;
    /** ADMIN autenticado — vem de `req.authorization`, nunca do corpo. */
    readonly actorPublicId: string;
    readonly correlationId?: string | undefined;
  }): Promise<ConfirmPortalClientSelectionResult> {
    // Formato antes de qualquer I/O: um corpo inválido não merece uma
    // consulta à fonte nem uma transação.
    const legacyId = normalizarLegacyId(request.legacyId);

    const cliente = await this.catalog.findById(legacyId);
    if (cliente === undefined) {
      throw new PortalCatalogClientNotFoundError(legacyId);
    }
    if (!cliente.active) {
      throw new PortalCatalogClientInactiveError(legacyId);
    }

    const vinculo = await this.linkService.execute({
      organizationPublicId: request.organizationPublicId,
      legacyId,
      actorPublicId: request.actorPublicId,
      correlationId: request.correlationId
    });

    return {
      ...vinculo,
      // Da RELEITURA, não do pedido.
      clientName: cliente.nome,
      clientDocumentMasked: maskCnpj(cliente.documentDigits)
    };
  }
}

/**
 * "Inteiro positivo" no sentido estrito — mesma checagem textual do
 * serviço de vínculo, e pelo mesmo motivo.
 *
 * `Number("")` e `Number(null)` são `0`: a conversão frouxa deixaria um
 * corpo vazio virar zero e ir consultar a fonte por um cliente que não
 * pode existir. Recusar aqui evita a ida ao banco do Portal e devolve o
 * código que a tela conhece.
 */
function normalizarLegacyId(bruto: unknown): number {
  if (typeof bruto === "number") {
    if (!Number.isSafeInteger(bruto) || bruto <= 0) {
      throw new PortalCatalogLegacyIdInvalidError();
    }
    return bruto;
  }
  if (typeof bruto === "string" && /^[1-9][0-9]*$/.test(bruto.trim())) {
    const numero = Number(bruto.trim());
    if (Number.isSafeInteger(numero)) {
      return numero;
    }
  }
  throw new PortalCatalogLegacyIdInvalidError();
}
