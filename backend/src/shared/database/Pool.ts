import mysql, { type Pool, type PoolOptions } from "mysql2/promise";

export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}

/**
 * Cria (mas não conecta imediatamente) um Pool mysql2/promise.
 *
 * Chamar esta função não abre nenhuma conexão de rede por si só — o
 * mysql2 conecta de forma preguiçosa, apenas quando uma query é
 * efetivamente executada. Nesta fatia (v0.4.0), nenhuma parte do
 * bootstrap da aplicação chama `execute` automaticamente, então nenhuma
 * conexão real ao MariaDB é aberta ao rodar `npm test`, `npm run
 * typecheck` ou `npm run build`.
 */
export function createPool(config: DatabaseConfig): Pool {
  const options: PoolOptions = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 10,
    // Optimistic locking depende de leituras consistentes dentro da
    // transação; deixamos o nível de isolamento padrão do servidor
    // (REPEATABLE READ no InnoDB) — nenhuma decisão adicional tomada
    // aqui além do que o MariaDB já define por padrão.
    dateStrings: false
  };
  return mysql.createPool(options);
}
