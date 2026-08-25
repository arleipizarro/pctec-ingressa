import { createPool } from "mysql2/promise";

/**
 * Sondas de PRÉ-CONDIÇÃO das suítes de integração.
 *
 * Algumas suítes não são apenas "precisam de banco": elas precisam de um
 * banco com uma propriedade específica — schema vazio, privilégio de
 * DDL, ou uma fixture previamente semeada. Quando essa propriedade não
 * existe, a suíte deve PULAR com motivo explícito, nunca falhar: uma
 * falha ali diz "o código quebrou" quando o que houve foi "o ambiente
 * não tem o que esta suíte exige", e o próximo a ler o relatório perde
 * tempo procurando bug onde não há.
 *
 * Pular por ambiente é diferente de pular por preguiça: cada sonda abaixo
 * é uma pergunta objetiva, respondida contra o banco real.
 */
export interface SondaConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

async function comPool<T>(config: SondaConfig, trabalho: (pool: ReturnType<typeof createPool>) => Promise<T>, padrao: T): Promise<T> {
  const pool = createPool(config);
  try {
    return await trabalho(pool);
  } catch {
    return padrao;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** O principal consegue CREATE/DROP neste schema? */
export async function podeExecutarDdl(config: SondaConfig): Promise<boolean> {
  const tabela = `sonda_ddl_${Date.now().toString(36)}`;
  return comPool(
    config,
    async (pool) => {
      await pool.query(`CREATE TABLE \`${tabela}\` (id INT PRIMARY KEY)`);
      await pool.query(`DROP TABLE \`${tabela}\``);
      return true;
    },
    false
  );
}

/** O principal consegue criar banco novo? (suítes que isolam migrations) */
export async function podeCriarBanco(config: SondaConfig): Promise<boolean> {
  const nome = `sonda_db_${Date.now().toString(36)}`;
  return comPool(
    config,
    async (pool) => {
      await pool.query(`CREATE DATABASE \`${nome}\``);
      await pool.query(`DROP DATABASE \`${nome}\``);
      return true;
    },
    false
  );
}

/** A tabela está vazia? Suítes de bootstrap exigem schema pristino. */
export async function tabelaEstaVazia(config: SondaConfig, tabela: string): Promise<boolean> {
  return comPool(
    config,
    async (pool) => {
      const [rows] = await pool.query(`SELECT COUNT(*) AS total FROM \`${tabela}\``);
      return Number((rows as { total: number | string }[])[0]?.total ?? 0) === 0;
    },
    false
  );
}

/** Existe alguma linha para esta consulta? Usado por suítes que dependem de fixture semeada. */
export async function existeLinha(config: SondaConfig, sql: string, params: readonly unknown[] = []): Promise<boolean> {
  return comPool(
    config,
    async (pool) => {
      const [rows] = await pool.query(sql, params as unknown[]);
      return (rows as unknown[]).length > 0;
    },
    false
  );
}
