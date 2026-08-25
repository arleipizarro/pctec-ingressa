/**
 * Porta de LEITURA da fonte Helpdesk.
 *
 * O domínio nunca vê `mysql2`, nem a linha crua de `users`. Ele vê estes
 * campos — e só estes existem porque cada um responde a uma pergunta da
 * decisão:
 *
 * | campo      | por que a decisão precisa dele                       |
 * |------------|------------------------------------------------------|
 * | `id`       | chave da IdentityExternalReference e do escopo        |
 * | `name`     | `full_name` da Identity proposta                      |
 * | `email`    | identidade da pessoa e detecção de colisão            |
 * | `role`     | prova de que é usuário EXTERNO (`cliente`)            |
 * | `active`   | inativo na origem não vira acesso no destino          |
 * | `clientId` | o ÚNICO vínculo cadastral que autoriza a Organization |
 *
 * O que não está aqui não está por decisão, não por esquecimento:
 * `client_group_id` (classificação, não concessão), `password`,
 * `reset_token`, `reset_expires`, `last_login`, `is_dispatcher`,
 * `pctecdb_id`. O principal MariaDB da fonte tem SELECT de COLUNA, então
 * a maioria deles não é sequer selecionável — a lista aqui e o GRANT lá
 * dizem a mesma coisa em dois lugares que falham fechado.
 */
export interface HelpdeskUserRecord {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly clientId: number | null;
}

export interface HelpdeskClientRecord {
  readonly id: number;
  readonly name: string;
  readonly active: boolean;
}

export interface HelpdeskSourceReader {
  /**
   * Lê os usuários do escopo do piloto.
   *
   * Recebe os ids em vez de lê-los de uma constante interna para que o
   * teste possa provar o comportamento com um id fora do escopo — a
   * trava não está aqui, está em `assertInPilotScope`, chamada pelo
   * planner sobre TUDO que a fonte devolver.
   */
  readUsersByIds(ids: readonly number[]): Promise<readonly HelpdeskUserRecord[]>;

  readClientById(clientId: number): Promise<HelpdeskClientRecord | undefined>;
}
