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
   * Devolve uma tentativa a contadores específicos — usado quando o
   * login foi BEM-SUCEDIDO.
   *
   * Existe para que uso legítimo não consuma orçamento: quem entra
   * corretamente várias vezes no mesmo dia (troca de dispositivo, sessão
   * expirada, logout deliberado) não pode acabar barrado pela própria
   * rotina. Um ataque, por definição, quase nunca acerta — então o
   * estorno praticamente não beneficia quem tenta adivinhar.
   *
   * Nunca desce abaixo de zero.
   */
  refund(buckets: readonly LoginRateLimitBucket[], now: Date): Promise<void>;
}
