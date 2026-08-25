import type { AuthorizationCode } from "./AuthorizationCode.js";

export interface AuthorizationCodeRepository {
  insert(authorizationCode: AuthorizationCode): Promise<void>;

  /**
   * CONSUMO ATÔMICO: marca `consumed_at` e devolve o código SOMENTE se
   * ele ainda estava por consumir e dentro da validade.
   *
   * A ordem importa e é o ponto do método: primeiro o `UPDATE ... WHERE
   * consumed_at IS NULL AND expires_at > NOW()`, depois a leitura. Um
   * `SELECT` seguido de `UPDATE` deixaria uma janela em que duas
   * requisições concorrentes leriam a mesma linha "não consumida" e
   * ambas seguiriam adiante — replay bem-sucedido por corrida, não por
   * falha de validação.
   *
   * `undefined` significa "não existe, já foi usado ou expirou" — as
   * três respostas colapsadas de propósito: distingui-las aqui só
   * mudaria de lugar o vazamento que `SsoAuthorizationCodeExchangeFailedError`
   * evita.
   */
  consumeByCodeHash(codeHash: string, now: Date): Promise<AuthorizationCode | undefined>;
}
