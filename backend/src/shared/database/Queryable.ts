/**
 * Abstração mínima sobre "algo capaz de executar uma query parametrizada",
 * compatível estruturalmente com `Pool` e `PoolConnection` de
 * `mysql2/promise`, sem que este arquivo (ou qualquer código que só
 * dependa desta interface) precise importar `mysql2`.
 *
 * Repositories dependem apenas de `Queryable` — nunca de `mysql2`
 * diretamente — o que mantém a camada de domínio/aplicação livre de
 * acoplamento com o driver de banco.
 */
export interface Queryable {
  execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]>;
}
