import type { LoginRateLimitBucket } from "../domain/LoginRateLimitPolicy.js";
import type { LoginRateLimitCounter, LoginRateLimitStore } from "../domain/LoginRateLimitStore.js";

/**
 * Dublê de teste dos contadores de tentativa de login, com a MESMA
 * semântica do `MariaDbLoginRateLimitStore`: incremento e reinício de
 * janela expirada numa operação só, contagem devolvida DEPOIS de
 * registrar a tentativa, e remoção do contador em caso de sucesso.
 *
 * **Memória aqui é legítima; em produção não seria.** A implementação
 * real vive em MariaDB justamente porque um contador por processo
 * deixaria de ser proteção com mais de um worker — ver
 * `LoginRateLimitStore`. Este arquivo existe só para que os testes de
 * rota não precisem de banco, e por isso mora em `tests/`.
 */
export class InMemoryLoginRateLimitStore implements LoginRateLimitStore {
  private readonly linhas = new Map<string, { windowStartedAt: Date; attemptCount: number }>();
  public limpezas = 0;
  public readonly escoposLimpos: string[] = [];

  public async consume(
    buckets: readonly LoginRateLimitBucket[],
    now: Date,
    windowSeconds: number
  ): Promise<readonly LoginRateLimitCounter[]> {
    const corte = new Date(now.getTime() - windowSeconds * 1000);
    return buckets.map((bucket) => {
      const atual = this.linhas.get(bucket.key);
      const linha =
        atual === undefined || atual.windowStartedAt <= corte
          ? { windowStartedAt: now, attemptCount: 1 }
          : { windowStartedAt: atual.windowStartedAt, attemptCount: atual.attemptCount + 1 };
      this.linhas.set(bucket.key, linha);
      return { bucket, attemptCount: linha.attemptCount, windowStartedAt: linha.windowStartedAt };
    });
  }

  public async clear(buckets: readonly LoginRateLimitBucket[]): Promise<void> {
    this.limpezas += 1;
    for (const bucket of buckets) {
      this.linhas.delete(bucket.key);
      this.escoposLimpos.push(bucket.kind);
    }
  }

  public contagem(key: string): number {
    return this.linhas.get(key)?.attemptCount ?? 0;
  }

  public chaves(): readonly string[] {
    return [...this.linhas.keys()];
  }
}
