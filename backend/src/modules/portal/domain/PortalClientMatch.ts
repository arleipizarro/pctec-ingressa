import type { PortalClientRecord } from "./PortalClientCatalogPort.js";

/**
 * Resultado da correspondência entre uma Organization do Ingressa e um
 * cliente do Portal.
 *
 * Quatro estados, e a assimetria entre eles é o desenho:
 *
 * - `EXACT_UNIQUE` — exatamente UM cliente **ativo** com o mesmo CNPJ
 *   normalizado. **É o único estado que autoriza vínculo automático.**
 * - `NOT_FOUND` — nenhum cliente, ativo ou não, tem este CNPJ. A
 *   empresa existe no Ingressa e ainda não tem correspondente no
 *   Portal, ou tem sob outro documento.
 * - `AMBIGUOUS` — mais de um cliente **ativo**. Fail-closed: nada é
 *   escolhido, nem pelo servidor nem pela tela. Escolher "o primeiro"
 *   aqui seria o mesmo erro que `LIMIT 1` esconde.
 * - `INACTIVE_ONLY` — o CNPJ existe no Portal, mas **só em cliente(s)
 *   inativo(s)**. Estado próprio, e não `NOT_FOUND`, porque as duas
 *   situações levam a ações diferentes: "não existe lá" pede cadastro
 *   no Portal; "existe e está inativo" pede reativação — e dizer
 *   "não encontrado" mandaria alguém cadastrar uma segunda vez a mesma
 *   empresa, criando exatamente a duplicidade que produz `AMBIGUOUS`.
 * - `DOCUMENT_MISSING_OR_INVALID` — a Organization não tem CNPJ
 *   comparável. Não é falha: é a maioria dos casos vindos do importador
 *   hoje, e o caminho dela é a seleção administrativa.
 *
 * **Cliente inativo nunca é candidato.** `clientes.ativo = 0` é a forma
 * de o Portal dizer que aquele cadastro saiu de operação; vincular uma
 * empresa a ele daria a ela um contexto comercial morto, e o vínculo
 * não tem desfazer. A exclusão acontece ANTES da contagem, e é por isso
 * que um ativo convivendo com um inativo de mesmo CNPJ é
 * `EXACT_UNIQUE`, e não ambiguidade: só existe um candidato.
 *
 * **Nunca existe um estado "parecido por nome".** Razão social e nome
 * fantasia divergem entre sistemas, se repetem entre filiais e mudam
 * sem aviso; um match por nome erra em silêncio e o erro só aparece
 * quando alguém lê o faturamento da empresa errada.
 */
export type PortalClientMatchStatus =
  | "EXACT_UNIQUE"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "INACTIVE_ONLY"
  | "DOCUMENT_MISSING_OR_INVALID";

export interface PortalClientMatchResult {
  readonly status: PortalClientMatchStatus;
  /**
   * Preenchido SOMENTE em `EXACT_UNIQUE` — e sempre um cliente ATIVO.
   * Em `AMBIGUOUS` e `INACTIVE_ONLY` fica `undefined` de propósito:
   * devolver um candidato junto de um aviso convida quem consome a
   * ignorar o aviso.
   */
  readonly client: PortalClientRecord | undefined;
  /**
   * Quantos candidatos existem NO ESTADO descrito: os ativos em
   * `EXACT_UNIQUE` (1) e `AMBIGUOUS` (>1); os inativos em
   * `INACTIVE_ONLY` (>0). `0` em `NOT_FOUND` e quando não há documento
   * comparável.
   */
  readonly candidateCount: number;
}
