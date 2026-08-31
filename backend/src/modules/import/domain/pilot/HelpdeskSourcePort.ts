/**
 * Porta de LEITURA da fonte Helpdesk.
 *
 * ## Estado desta fonte
 *
 * Duas autoridades, dois schemas, uma conexão:
 *
 *  - EMPRESAS no registro autoritativo (`HELPDESK_REGISTRY_DB_NAME`
 *    `.clientes`), de onde o próprio Helpdesk lê;
 *  - USUÁRIOS em `HELPDESK_DB_NAME`.`users`, que é o que o Helpdesk
 *    trata como autoridade de fato — autenticação e gravação de `role`,
 *    `client_id` e `active` acontecem lá.
 *
 * `helpdesk_usuarios` não é fonte: nenhum `SELECT` do Helpdesk a
 * consulta e ela não carrega o vínculo com a empresa.
 *
 * Os dois métodos de usuário continuam podendo RECUSAR, com
 * `HELPDESK_USER_SOURCE_UNAVAILABLE` — hoje só quando a fonte
 * realmente não pôde ser consultada (privilégio negado, objeto
 * inexistente, transporte caído). A recusa segue no contrato porque a
 * alternativa seria devolver lista vazia, e "não consegui perguntar" e
 * "perguntei e não há ninguém" levam a ações opostas. Ver
 * `HelpdeskUserSourceUnavailableError`.
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

/**
 * Empresa como o REGISTRO AUTORITATIVO a descreve.
 *
 * `documentNumber` faz parte do registro, e não de uma leitura à parte:
 * no registro autoritativo o documento é cadastro como qualquer outro
 * campo. Ele chega aqui já decidido — 14 dígitos ou `null` —, nunca
 * cru: quem normaliza é a fronteira, porque é lá que se sabe que a
 * coluna guarda CPF e CNPJ na mesma string, com máscara.
 *
 * `null` significa exatamente uma coisa: **esta empresa não tem CNPJ
 * utilizável**. Documento ausente, `tipo_doc = 'cpf'` e documento
 * malformado caem todos aqui, e o efeito é o mesmo — a organização
 * nasce sem documento e o vínculo com o Portal fica pendente de decisão
 * administrativa. Nunca há correspondência por CPF, e nunca há queda
 * para o nome.
 */
export interface HelpdeskClientRecord {
  readonly id: number;
  readonly name: string;
  readonly active: boolean;
  readonly documentNumber: string | null;
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
