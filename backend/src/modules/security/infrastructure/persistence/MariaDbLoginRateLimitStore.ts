import type { Queryable } from "../../../../shared/database/Queryable.js";
import type { LoginRateLimitBucket } from "../../domain/LoginRateLimitPolicy.js";
import type { LoginRateLimitCounter, LoginRateLimitStore } from "../../domain/LoginRateLimitStore.js";

type CounterRow = { readonly window_started_at: unknown; readonly attempt_count: unknown };

function lerData(valor: unknown): Date {
  if (valor instanceof Date) {
    return valor;
  }
  if (typeof valor === "string") {
    return new Date(valor);
  }
  throw new Error('Coluna "window_started_at" ausente ou não é data em auth_rate_limit_counters.');
}

function lerNumero(valor: unknown): number {
  if (typeof valor === "number") {
    return valor;
  }
  if (typeof valor === "string" && valor.trim().length > 0) {
    return Number(valor);
  }
  throw new Error('Coluna "attempt_count" ausente ou não é número em auth_rate_limit_counters.');
}

/**
 * Contadores de tentativa de login em MariaDB — migration 0025.
 *
 * ## Atomicidade
 *
 * O incremento é UM `INSERT ... ON DUPLICATE KEY UPDATE`, que o InnoDB
 * executa sob trava de linha. Duas requisições concorrentes para o mesmo
 * contador são serializadas pelo próprio motor; nenhuma tentativa se
 * perde. Um `SELECT` seguido de `UPDATE` — a forma ingênua — perderia
 * exatamente o caso que interessa, que é o ataque em paralelo.
 *
 * O `SELECT` que vem logo depois lê a contagem resultante. Ele pode ver
 * um valor MAIOR que o desta requisição, se outra tiver incrementado no
 * intervalo; nunca menor, porque o incremento próprio já está commitado.
 * O erro possível é, portanto, sempre na direção de barrar antes — e
 * essa é a direção segura para um limitador.
 *
 * ## Reinício de janela dentro do próprio statement
 *
 * `attempt_count = IF(window_started_at > :corte, attempt_count + 1, 1)`
 * resolve, na mesma instrução, os dois casos: janela ainda válida
 * (incrementa) e janela expirada (recomeça em 1, com `window_started_at`
 * carimbado em `:agora`). Não existe passo separado de expiração, e
 * portanto não existe janela entre "expirou" e "reiniciou" em que dois
 * processos disputem o reinício.
 *
 * ## O que NUNCA é gravado
 *
 * Só o digest do escopo. Nem IP, nem e-mail, nem senha, nem token —
 * nada em claro. `scope_kind` diz apenas se o contador é de origem ou
 * de origem+identificador, o que é diagnóstico e não identifica
 * ninguém.
 */
export class MariaDbLoginRateLimitStore implements LoginRateLimitStore {
  public constructor(private readonly connection: Queryable) {}

  public async consume(
    buckets: readonly LoginRateLimitBucket[],
    now: Date,
    windowSeconds: number
  ): Promise<readonly LoginRateLimitCounter[]> {
    const corte = new Date(now.getTime() - windowSeconds * 1000);
    const counters: LoginRateLimitCounter[] = [];

    for (const bucket of buckets) {
      await this.connection.execute(
        `INSERT INTO auth_rate_limit_counters
           (bucket_key, scope_kind, window_started_at, attempt_count, updated_at)
         VALUES (?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           attempt_count     = IF(window_started_at > ?, attempt_count + 1, 1),
           window_started_at = IF(window_started_at > ?, window_started_at, ?),
           updated_at        = ?`,
        [bucket.key, bucket.kind, now, now, corte, corte, now, now]
      );

      const [rows] = await this.connection.execute(
        `SELECT window_started_at, attempt_count
           FROM auth_rate_limit_counters
          WHERE bucket_key = ?`,
        [bucket.key]
      );
      const linha = (rows as CounterRow[])[0];
      if (linha === undefined) {
        // A linha acabou de ser gravada por esta mesma conexão; não
        // encontrá-la significa que algo apagou o contador no meio da
        // operação. Falhar é a resposta certa — assumir "primeira
        // tentativa" seria o caminho para não limitar nada.
        throw new Error("Contador de rate limit desapareceu logo após ser gravado.");
      }

      counters.push({
        bucket,
        attemptCount: lerNumero(linha.attempt_count),
        windowStartedAt: lerData(linha.window_started_at)
      });
    }

    return counters;
  }

  /**
   * Estorno de UMA tentativa, com piso em zero e sem tocar em contador
   * de janela já expirada — devolver crédito a uma janela que não é mais
   * a vigente não teria efeito nenhum, e reabriria a janela antiga.
   */
  public async refund(buckets: readonly LoginRateLimitBucket[], now: Date): Promise<void> {
    for (const bucket of buckets) {
      await this.connection.execute(
        `UPDATE auth_rate_limit_counters
            SET attempt_count = GREATEST(attempt_count - 1, 0),
                updated_at = ?
          WHERE bucket_key = ?
            AND attempt_count > 0`,
        [now, bucket.key]
      );
    }
  }
}
