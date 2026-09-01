import { createHash } from "node:crypto";

/**
 * Que tipo de escopo um contador representa. Existe para diagnóstico e
 * para a telemetria — nunca para decidir nada, e nunca carrega o valor
 * que originou o contador.
 */
export type LoginRateLimitScopeKind = "IP" | "IP_IDENTIFIER";

export interface LoginRateLimitBucket {
  /**
   * SHA-256 (hex) do escopo. **O valor em claro nunca é persistido nem
   * registrado em lugar nenhum** — nem o IP, nem o e-mail. O contador
   * precisa saber que duas tentativas vieram do mesmo lugar; não precisa
   * saber de onde.
   */
  readonly key: string;
  readonly kind: LoginRateLimitScopeKind;
  readonly limit: number;
}

export interface LoginRateLimitConfig {
  readonly enabled: boolean;
  readonly windowSeconds: number;
  /**
   * Teto por ORIGEM. Generoso de propósito: um escritório inteiro sai
   * por um NAT só, e apertar aqui transformaria um dia normal em
   * indisponibilidade para todo mundo atrás daquele IP.
   */
  readonly maxAttemptsPerIp: number;
  /**
   * Teto por (origem + identificador). É o limite que de fato barra
   * adivinhação de senha, e é apertado.
   */
  readonly maxAttemptsPerIpIdentifier: number;
}

export const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimitConfig = Object.freeze({
  enabled: true,
  windowSeconds: 900,
  maxAttemptsPerIp: 60,
  maxAttemptsPerIpIdentifier: 10
});

/**
 * Política de limitação de tentativas de login — parte PURA, sem banco,
 * sem HTTP e sem relógio próprio.
 *
 * ## Por que DOIS escopos, e por que o segundo inclui o IP
 *
 * Um limite só por IP não protege contra adivinhação: quem tenta 60
 * senhas distribui entre 60 e-mails e nunca encosta no teto do escopo
 * apertado. Um limite só por e-mail protege contra adivinhação, mas cria
 * uma arma: qualquer pessoa que conheça um e-mail consegue TRANCAR
 * aquela conta de qualquer lugar do mundo, só errando a senha algumas
 * vezes. É uma negação de serviço direcionada, entregue de graça.
 *
 * Combinar `(IP + identificador)` fecha os dois: adivinhar a senha de
 * alguém exige muitas tentativas contra o MESMO e-mail, e todas elas
 * caem no mesmo contador; e trancar a conta de outra pessoa passa a
 * exigir controle do IP dela, o que já não é um ataque à distância.
 * O contador por IP puro fica como teto largo, contra varredura de
 * muitos e-mails a partir de uma origem só.
 *
 * ## Por que não revela se o e-mail existe
 *
 * Os contadores são construídos a partir do que foi ENVIADO, antes de
 * qualquer consulta ao banco: nada aqui sabe — nem pode saber — se
 * aquele e-mail corresponde a uma Identity. Um e-mail inexistente e um
 * existente produzem exatamente o mesmo contador, o mesmo limite, a
 * mesma resposta e o mesmo `Retry-After`. Não há nenhum canal por onde
 * a existência vaze.
 *
 * ## Por que o e-mail nunca é persistido
 *
 * A chave é o digest do escopo. Ele basta para agrupar tentativas e não
 * serve para nada além disso — em particular, a tabela de contadores
 * jamais vira uma lista de e-mails que tentaram entrar.
 */
export class LoginRateLimitPolicy {
  /**
   * Separador das partes do digest. Byte NUL: não pode aparecer em IP
   * nem em e-mail, o que impede que `("a", "bc")` e `("ab", "c")`
   * produzam a mesma chave — colisão que um separador comum (`:`, `|`)
   * permitiria construir de propósito.
   */
  private static readonly SEPARADOR = "\u0000";

  public constructor(private readonly config: LoginRateLimitConfig) {}

  public getConfig(): LoginRateLimitConfig {
    return this.config;
  }

  /**
   * Normalização IDÊNTICA à do Value Object `Email` (trim + minúsculas).
   *
   * Deliberadamente NÃO valida formato: um e-mail malformado precisa
   * seguir exatamente o mesmo caminho de um bem formado, incluindo
   * consumir tentativa. Validar aqui criaria uma resposta distinta —
   * mais rápida, ou com outro status — e essa diferença é observável.
   */
  private static normalizeIdentifier(raw: string): string {
    return raw.trim().toLowerCase();
  }

  private static digest(...partes: readonly string[]): string {
    return createHash("sha256").update(partes.join(LoginRateLimitPolicy.SEPARADOR), "utf8").digest("hex");
  }

  /**
   * Contadores que esta tentativa consome.
   *
   * Sem identificador (corpo ausente ou sem `email`), só o escopo de
   * origem é consumido — nunca zero contadores: uma requisição sem corpo
   * ainda é uma tentativa, e não pode ser o caminho barato para escapar
   * do limite.
   */
  public buildBuckets(input: {
    readonly clientIp: string;
    readonly identifier: string | undefined;
  }): readonly LoginRateLimitBucket[] {
    const buckets: LoginRateLimitBucket[] = [
      {
        key: LoginRateLimitPolicy.digest("ip", input.clientIp),
        kind: "IP",
        limit: this.config.maxAttemptsPerIp
      }
    ];

    const identificador =
      input.identifier === undefined ? "" : LoginRateLimitPolicy.normalizeIdentifier(input.identifier);
    if (identificador.length > 0) {
      buckets.push({
        key: LoginRateLimitPolicy.digest("ip-identifier", input.clientIp, identificador),
        kind: "IP_IDENTIFIER",
        limit: this.config.maxAttemptsPerIpIdentifier
      });
    }

    return buckets;
  }

  /**
   * `Retry-After` em segundos, a partir do início da janela do contador
   * que estourou.
   *
   * Sempre pelo menos 1: `Retry-After: 0` convida a repetir na hora, e
   * um contador que acabou de estourar no último milissegundo da janela
   * arredondaria para zero.
   */
  public retryAfterSeconds(windowStartedAt: Date, now: Date): number {
    const decorridos = Math.floor((now.getTime() - windowStartedAt.getTime()) / 1000);
    return Math.max(1, this.config.windowSeconds - decorridos);
  }
}
