/**
 * Porta de LEITURA do catálogo de clientes do Portal
 * (`pctecdb.clientes`).
 *
 * O domínio nunca vê `mysql2` nem a linha crua. Ele vê estes campos — e
 * cada um está aqui porque responde a uma pergunta da decisão:
 *
 * | campo             | por que a decisão precisa dele                      |
 * |-------------------|-----------------------------------------------------|
 * | `id`              | é o `legacyId` da OrganizationExternalReference      |
 * | `nome`            | o ADMIN precisa reconhecer quem está selecionando    |
 * | `nomeFantasia`    | idem — muitos clientes só são reconhecidos por ele   |
 * | `documentDigits`  | a ÚNICA base da correspondência automática           |
 * | `active`          | um cliente inativo não é sugerido sozinho            |
 *
 * O que não está aqui não está por decisão: `telefone`, `email`,
 * endereço, `em_rollout` e qualquer coluna comercial. Nenhuma delas
 * participa da escolha de vínculo, e trazê-las abriria uma porta de
 * leitura do cadastro do Portal por uma tela que só precisa escolher um
 * `id`.
 *
 * `documentDigits` é `undefined` quando o cliente não tem CNPJ
 * comparável (nulo, vazio, CPF ou qualquer coisa que não normalize para
 * 14 dígitos). Ele NUNCA sai numa resposta HTTP: o que sai é a máscara
 * de `maskCnpj`.
 */
export interface PortalClientRecord {
  readonly id: number;
  readonly nome: string;
  readonly nomeFantasia: string | null;
  readonly documentDigits: string | undefined;
  readonly active: boolean;
}

export interface PortalClientPage {
  readonly items: readonly PortalClientRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface PortalClientSearchQuery {
  /** Termo administrativo — nome ou nome fantasia. Nunca produz vínculo sozinho. */
  readonly q?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface PortalClientCatalogReader {
  /**
   * TODOS os clientes com o CNPJ normalizado informado — 0, 1 ou mais.
   *
   * Nunca `LIMIT 1`. "Quantos existem" é parte da decisão: com
   * `LIMIT 1`, dois cadastros duplicados no Portal virariam um vínculo
   * automático silencioso para o primeiro que o motor devolvesse, e a
   * empresa errada passaria a enxergar o faturamento da outra.
   */
  findByDocument(documentDigits: string): Promise<readonly PortalClientRecord[]>;

  /** Busca administrativa paginada — a base inteira nunca sai de uma vez. */
  search(query: PortalClientSearchQuery): Promise<PortalClientPage>;

  findById(clientId: number): Promise<PortalClientRecord | undefined>;
}
