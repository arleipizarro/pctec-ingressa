import type { PortalClientCatalogReader } from "../domain/PortalClientCatalogPort.js";
import type { PortalClientMatchResult } from "../domain/PortalClientMatch.js";
import { normalizePortalDocument } from "../domain/value-objects/PortalDocument.js";

/**
 * A ÚNICA definição de "este cliente do Portal é esta empresa".
 *
 * Existe uma vez e é chamada de três lugares — a criação manual de
 * COMPANY, a sugestão da tela e a reconciliação em lote. Um segundo
 * lugar que decidisse a mesma coisa (por exemplo, dentro do importador)
 * divergiria no primeiro ajuste feito de um lado só, e o sintoma seria
 * uma empresa vinculada ao cliente errado — o erro mais caro desta
 * integração, porque só aparece quando alguém lê o faturamento.
 *
 * ## A regra
 *
 * CNPJ normalizado (só dígitos, exatamente 14), comparado por
 * **igualdade** dos dois lados, **entre clientes ATIVOS**. Nada mais
 * entra na decisão:
 *
 * - **nunca por nome.** Razão social e nome fantasia divergem entre
 *   sistemas, se repetem entre filiais e mudam sem aviso;
 * - **nunca por semelhança.** Não há `LIKE`, distância de edição nem
 *   prefixo neste caminho;
 * - **nunca "o primeiro".** Com dois candidatos ativos, o resultado é
 *   `AMBIGUOUS` e ninguém escolhe;
 * - **nunca um cliente inativo.** `clientes.ativo = 0` é o Portal
 *   dizendo que aquele cadastro saiu de operação. A consulta traz os
 *   inativos — precisamos deles para distinguir "não existe lá" de
 *   "existe e está desativado" — mas eles são separados ANTES da
 *   contagem, e por isso um ativo convivendo com um inativo de mesmo
 *   CNPJ é `EXACT_UNIQUE`, não ambiguidade.
 *
 * ## O que este serviço NÃO faz
 *
 * Não escreve. Não conhece `OrganizationExternalReference`, transação,
 * bloqueio nem auditoria. Ele responde uma pergunta; quem transforma a
 * resposta em vínculo é o `LinkPortalOrganizationReferenceService`, com
 * o `FOR UPDATE` e a idempotência dele. Separar as duas coisas é o que
 * permite a tela perguntar sem arriscar escrever.
 */
export class MatchPortalClientByDocumentService {
  public constructor(private readonly catalog: PortalClientCatalogReader) {}

  /**
   * `rawDocument` é o documento da Organization, como está persistido
   * (já normalizado) ou como veio de uma fonte externa (com pontuação).
   * Os dois passam pela mesma normalização — é o que garante que a
   * comparação seja a mesma nos três chamadores.
   */
  public async execute(rawDocument: string | null | undefined): Promise<PortalClientMatchResult> {
    const digitos = normalizePortalDocument(rawDocument);
    if (digitos === undefined) {
      return { status: "DOCUMENT_MISSING_OR_INVALID", client: undefined, candidateCount: 0 };
    }

    const candidatos = await this.catalog.findByDocument(digitos);
    if (candidatos.length === 0) {
      return { status: "NOT_FOUND", client: undefined, candidateCount: 0 };
    }

    // A separação vem ANTES da contagem. Contar primeiro e filtrar
    // depois transformaria "um ativo e um inativo" em ambiguidade — e
    // mandaria alguém resolver à mão um caso que não tem dúvida
    // nenhuma: existe exatamente um candidato.
    const ativos = candidatos.filter((cliente) => cliente.active);
    if (ativos.length === 0) {
      // O CNPJ existe no Portal, mas só em cadastro desativado. Dizer
      // `NOT_FOUND` aqui mandaria cadastrar de novo a mesma empresa,
      // criando a duplicidade que depois vira `AMBIGUOUS`.
      return { status: "INACTIVE_ONLY", client: undefined, candidateCount: candidatos.length };
    }
    if (ativos.length > 1) {
      // Fail-closed: `client` fica `undefined` de propósito. Devolver
      // "o primeiro junto com um aviso" convidaria quem consome a
      // ignorar o aviso.
      return { status: "AMBIGUOUS", client: undefined, candidateCount: ativos.length };
    }
    return { status: "EXACT_UNIQUE", client: ativos[0], candidateCount: 1 };
  }
}
