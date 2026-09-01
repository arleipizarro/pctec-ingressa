import type { LoginRateLimitBucket } from "./LoginRateLimitPolicy.js";

export interface LoginRateLimitCounter {
  readonly bucket: LoginRateLimitBucket;
  /** Contagem DEPOIS de registrar esta tentativa. */
  readonly attemptCount: number;
  readonly windowStartedAt: Date;
}

/**
 * Armazenamento COMPARTILHADO dos contadores de tentativa de login.
 *
 * **Compartilhado é requisito, não detalhe.** O Ingressa roda hoje em um
 * processo só (PM2, `exec_mode: fork`, `instances: 1`), mas um limitador
 * que viva na memória do processo deixa de ser proteção no dia em que
 * subirem dois: cada worker teria seu próprio contador, e o teto efetivo
 * viraria "limite × número de workers" — sem nenhum sinal de que a
 * garantia mudou. Pior ainda, todo `pm2 restart` zeraria os contadores,
 * o que um atacante paciente aproveita de graça.
 *
 * Por isso o contrato é de armazenamento externo desde o primeiro dia, e
 * a implementação vive em MariaDB — que já é o ponto de coordenação
 * compartilhado deste sistema (sessões, códigos de autorização, chaves
 * únicas). Nenhum componente novo de infraestrutura foi introduzido: a
 * auditoria do ambiente não encontrou Redis instalado, ativo, nem
 * declarado como dependência em nenhum produto do parque.
 *
 * `consume` precisa ser ATÔMICO por contador: ler-e-depois-gravar
 * perderia tentativas concorrentes, que é exatamente o padrão de quem
 * ataca em paralelo.
 */
export interface LoginRateLimitStore {
  /**
   * Registra uma tentativa em cada contador e devolve a contagem
   * resultante, junto do início da janela vigente.
   *
   * A janela é fixa com reinício: quando a janela do contador já expirou,
   * ela recomeça em `now` e a contagem volta a 1.
   */
  consume(
    buckets: readonly LoginRateLimitBucket[],
    now: Date,
    windowSeconds: number
  ): Promise<readonly LoginRateLimitCounter[]>;

  /**
   * REMOVE os contadores indicados — usado quando o login foi
   * BEM-SUCEDIDO, e **somente** para o escopo `IP_IDENTIFIER`.
   *
   * ## Por que remover, e não estornar 1
   *
   * O contador apertado existe para barrar adivinhação de senha contra
   * UM identificador a partir de UMA origem. Um login correto prova, no
   * único momento em que isso é demonstrável, que quem está ali conhece
   * a senha — e o histórico de erros anteriores daquela combinação
   * perde o sentido de proteção: eram tentativas da mesma pessoa
   * digitando errado. Estornar 1 deixaria resíduo de tentativas
   * legítimas acumulando entre sucessos até barrar quem nunca errou de
   * verdade; remover a linha zera de uma vez e ainda devolve o espaço.
   *
   * ## Por que o escopo `IP` NUNCA é tocado aqui
   *
   * O contador por origem tem outro objetivo: limitar VOLUME vindo de um
   * lugar e proteger a CPU do Argon2id. Toda tentativa custa o mesmo
   * trabalho, tenha ela acertado ou não — então toda tentativa consome
   * capacidade daquele teto, independentemente do desfecho. Devolver
   * crédito no sucesso daria a quem tem uma credencial válida um jeito
   * de renovar orçamento de graça: alternar acerto e erro manteria o
   * contador de origem eternamente abaixo do limite, e o teto largo
   * deixaria de existir justamente para quem já está dentro.
   *
   * ## Concorrência
   *
   * A remoção é por chave primária, atômica no motor. Ela pode apagar
   * uma tentativa concorrente que tenha incrementado o mesmo contador
   * entre a resposta e a remoção — janela de milissegundos, limitada ao
   * par `(origem, identificador)` que acabou de autenticar com sucesso,
   * e sem efeito nenhum sobre o teto de origem, que continua contando
   * tudo. Ver ADR-034.
   *
   * Remover contador inexistente é no-op.
   */
  clear(buckets: readonly LoginRateLimitBucket[]): Promise<void>;
}
