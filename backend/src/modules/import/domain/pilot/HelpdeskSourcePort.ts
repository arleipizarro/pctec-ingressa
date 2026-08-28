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

/**
 * Resultado da leitura do CNPJ de uma empresa da origem.
 *
 * Duas respostas, e a diferença entre elas é o ponto:
 *
 *  - `available: false` — a FONTE não fornece o campo a este
 *    consumidor. `pctec_helpdesk.clients` **tem** a coluna `cnpj`
 *    (`VARCHAR(20)`, confirmado no schema), mas o principal read-only
 *    do Ingressa tem SELECT de COLUNA em `(id, name, active)` e nada
 *    mais: pedir `cnpj` responde `ERROR 1143 ... for column 'cnpj'`.
 *    Enquanto o GRANT não for ampliado por decisão explícita de quem
 *    opera, esta é a resposta em DEV e em PRD;
 *  - `available: true` com `documentNumber` possivelmente `null` — a
 *    fonte fornece o campo, e AQUELA empresa não tem CNPJ preenchido.
 *
 * Confundir as duas produziria a pior conclusão possível: "o Helpdesk
 * não tem CNPJ de ninguém" a partir de uma negativa de privilégio. Uma
 * é configuração, a outra é dado.
 *
 * O que NÃO existe em nenhuma das duas: cair para o nome. Razão social
 * não é evidência de correspondência nesta integração, nem aqui nem no
 * catálogo do Portal.
 */
export type HelpdeskClientDocumentRead =
  | { readonly available: false }
  | { readonly available: true; readonly documentNumber: string | null };

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

  /**
   * CNPJ da empresa de origem — OPCIONAL no contrato, de propósito.
   *
   * Opcional porque a capacidade depende do GRANT da credencial, e não
   * da existência do método: uma fonte que não implemente isto é
   * tratada exatamente como uma que responda `available: false`. Fazer
   * dela um método obrigatório forçaria todo dublê de teste a fingir
   * uma capacidade que a fonte real não tem hoje.
   *
   * Fica FORA de `HelpdeskClientRecord` pelo mesmo motivo: incluir
   * `cnpj` na projeção do catálogo faria TODA listagem de empresas
   * falhar por falta de privilégio — inclusive a etapa 1 do assistente,
   * que hoje funciona. A capacidade nova não pode quebrar a que já
   * está em uso.
   */
  readClientDocument?(clientId: number): Promise<HelpdeskClientDocumentRead>;
}
