# Fonte Helpdesk — contrato atual do assistente de importação

> Estado em 2026-08-31. Este documento descreve **de onde** o assistente
> de importação lê e **por quê**.
>
> A revisão de 2026-08-31 corrige um erro de fato da revisão de
> 2026-08-28, que declarava a fonte de usuários bloqueada. O registro do
> erro está preservado em "Usuários — o bloqueio que não deveria ter
> existido": apagá-lo faria a próxima pessoa refazer o mesmo raciocínio
> sobre as mesmas evidências.

## Resumo

| o que | de onde vem hoje | estado |
|---|---|---|
| Empresas | `HELPDESK_REGISTRY_DB_NAME`.`clientes` | **funcionando** |
| Documento (CNPJ) | mesma projeção, coluna `documento` + `tipo_doc` | **funcionando** |
| Usuários | `HELPDESK_DB_NAME`.`users` | **funcionando** |

As duas autoridades vivem em schemas diferentes do mesmo servidor e são
lidas pela **mesma conexão** — dois pools não poderiam cruzá-las. O elo
entre elas é `users.client_id`, que referencia `clientes.id` no registro
autoritativo.

## Empresas — migradas para o registro autoritativo

O Helpdesk moveu o cadastro de clientes para outro schema do mesmo
servidor, e essa migração **está concluída do lado dele**: o backend do
Helpdesk mantém um pool próprio para aquele schema e lê o cadastro de
lá (`routes/clients.js`), projetando `nome`, `documento` e `ativo`.

O assistente passou a ler do mesmo lugar. O schema **não é fixo no
código**: vem de `HELPDESK_REGISTRY_DB_NAME`, obrigatório e sem default,
validado como identificador SQL antes de entrar no texto da consulta —
`?` liga valores, não identificadores de schema, então a defesa é lista
branca no carregamento e de novo no ponto de montagem.

O JOIN entre os dois schemas usa a **mesma conexão**: são dois schemas
do mesmo servidor, e dois pools não poderiam cruzá-los.

### Documento

A consulta separada de CNPJ deixou de existir. Ela nascera de um
problema que não existe mais: a projeção antiga vinha de uma tabela cujo
GRANT de coluna não incluía o documento, e pedi-lo junto derrubaria toda
a listagem com `ERROR 1143`. No registro autoritativo o documento é
cadastro como qualquer outro campo.

A normalização é estrita e produz **14 dígitos ou `null`**:

- `tipo_doc` diferente de `cnpj` → `null`. A coluna guarda CPF e CNPJ na
  mesma string; aceitar um CPF o ofereceria à correspondência automática
  com o Portal, que casa **empresas**;
- documento ausente ou vazio → `null`;
- documento que, sem máscara, não tem exatamente 14 dígitos → `null`.
  Completar ou truncar seria inventar o CNPJ de alguém.

Nos três casos a organização é criada **sem documento** e o vínculo com
o Portal fica `PENDING_DOCUMENT`, pendente de decisão administrativa.
Nunca há correspondência por CPF, e nunca há queda para o nome.

O documento **entra no `scopeFingerprint`**, na sua forma canônica.

Ele decide três coisas a jusante: o CNPJ gravado na Organization, a
correspondência com o catálogo do Portal e o resultado do `AutoLink`.
Fora do fingerprint, um CNPJ trocado no cadastro entre a revisão do
dry-run e o APPLY passaria despercebido, e o APPLY seguiria adiante
vinculando a organização a um cliente do Portal que **ninguém revisou**.

O que entra é a forma canônica — 14 dígitos ou `null` —, e é isso que
separa *"o CNPJ mudou"* de *"a máscara mudou"*:

| mudança na origem | fingerprint |
|---|---|
| `11.222.333/0001-81` → `11222333000181` | **igual** — mesma forma canônica |
| espaços ou pontuação diferentes | **igual** |
| outros 14 dígitos | **muda** |
| `null` → CNPJ, ou CNPJ → `null` | **muda** |
| CPF → CNPJ, ou CNPJ → CPF | **muda** (o CPF é `null` canônico) |

Quando muda, o APPLY é recusado com `IMPORT_SOURCE_CHANGED_SINCE_DRY_RUN`
— o código que o domínio já usava para "a origem mudou" — e o operador
roda um novo dry-run. A recusa acontece no portão de abertura do lote,
que valida antes de inserir: nenhuma organização, Identity, Membership,
referência ou lote é escrito, e o `AutoLink` não é chamado.

## Usuários — `HELPDESK_DB_NAME`.`users`

A tabela `users` do schema do Helpdesk é a autoridade de usuários, e
isso foi verificado no código vivo e nos dois ambientes:

- a autenticação procura lá — `routes/auth.js`,
  `SELECT ... FROM users WHERE email = ? AND active = 1`. Para o
  colaborador interno (`pctecdb_id` preenchido) a *senha* é delegada a
  `pctecdb.usuarios`, mas a linha de autorização continua sendo a de
  `users`;
- `role`, `client_id`, `client_group_id` e `active` são lidos e
  gravados lá — `routes/users.js`;
- `users.client_id` referencia **`pctecdb.clientes.id`**: é o registro
  autoritativo de empresas que `routes/users.js` consulta para resolver
  o nome do cliente. É o mesmo espaço de identificadores que o catálogo
  de empresas deste assistente já usa.

`helpdesk_usuarios` **não** é a fonte, e isto continua valendo: ela
aparece em um único ponto do backend do Helpdesk (um `INSERT IGNORE`
que grava `(usuario_id, role, active)`), **nenhum `SELECT`** a consulta,
e ela não carrega o vínculo com a empresa.

### Projeção — seis colunas, e só

```sql
SELECT id, name, email, role, active, client_id
  FROM `<HELPDESK_DB_NAME>`.users
 WHERE id IN (?, ...)        -- escopo selecionado
```

| coluna | por que a decisão precisa dela |
|---|---|
| `id` | chave da `IdentityExternalReference` e do escopo |
| `name` | `full_name` da Identity proposta |
| `email` | identidade da pessoa e detecção de colisão |
| `role` | prova de que é usuário EXTERNO (`cliente`) |
| `active` | inativo na origem não vira acesso no destino |
| `client_id` | o ÚNICO vínculo cadastral que autoriza a Organization |

Fora da projeção, **por decisão**: `password`, `reset_token`,
`reset_expires` e `last_login` (credencial e sessão, na mesma linha do
cadastro); `pctecdb_id`, `is_dispatcher` e `created_at` (descrevem o
usuário dentro do Helpdesk, não a decisão de importá-lo); e
`client_group_id` — grupo é classificação, não concessão, e ele
permanece em `FORBIDDEN_SQL_TABLES`, então nem um filtro esperto o
alcança.

O schema é qualificado no texto da consulta a partir de
`HELPDESK_DB_NAME`, validado como identificador SQL no carregamento e
de novo no ponto de montagem — o mesmo tratamento do registro. O
qualificador é **separado** do de empresas de propósito: reusar aquele
produziria `pctecdb.users`, que não existe.

### Nenhum filtro no SQL

A consulta traz **todos os papéis e também os inativos**. A
elegibilidade é decidida no domínio (`avaliarElegibilidade`), com motivo
registrado item a item: `SOURCE_USER_INACTIVE`,
`SOURCE_USER_NOT_EXTERNAL_ROLE`, `SOURCE_USER_WITHOUT_CLIENT_LINK`,
`SOURCE_USER_CLIENT_OUT_OF_SELECTION`, `SOURCE_EMAIL_INVALID`.

Filtrar no SQL apagaria a diferença entre "não é elegível" e "não
existe", e a tela deixaria de poder explicar ao ADMIN por que o interno
vinculado àquela empresa não é importável.

## Usuários — o bloqueio que não deveria ter existido

Entre 2026-08-28 e 2026-08-31 a importação de usuários ficou recusando
com `HELPDESK_USER_SOURCE_UNAVAILABLE` (HTTP 503). **A premissa era
falsa**, e o registro fica aqui para que ninguém a reconstrua.

O commit `a9b052b` afirmava:

> "A migration 005 do Helpdesk as removeu ao mover o cadastro de
> clientes para outro schema. […] Essa tabela não existe mais no
> servidor."

O que a evidência mostra:

- `migration_005_pctecdb_integration.sql` está em **QUARENTENA** no
  manifesto do próprio Helpdesk
  (`backend/src/config/migrations.manifest.json`):
  `"quarantined": true`, `"baselineable": "never"`, com a justificativa
  *"o ambiente evoluiu por outro caminho e esta migration nunca foi
  aplicada lá"*. Ela nunca entra no fluxo automático do runner;
- `pctec_helpdesk.users` **existe** em DEV e em PRD, com o mesmo
  conteúdo agregado: 170 linhas, sendo 142 `role='cliente'` ativas, 141
  delas com `client_id`, cobrindo 57 empresas;
- os 57 `client_id` distintos resolvem **100%** em `pctecdb.clientes.id`;
- a projeção de seis colunas responde com a credencial read-only que já
  existia — nenhum GRANT novo foi necessário.

O que a auditoria original acertou, e continua valendo: `helpdesk_usuarios`
não é substituta, e grupo empresarial não concede acesso.

### O que sobreviveu à correção

A distinção que o erro protegia era certa, mesmo com a premissa errada:
*"não consegui perguntar"* e *"perguntei e não há ninguém"* levam a
ações opostas. A segunda leitura convida quem opera a concluir a
importação sem usuários, ou a recadastrá-los à mão — decisões tomadas
sobre uma informação que ninguém verificou.

Por isso `HELPDESK_USER_SOURCE_UNAVAILABLE` **não foi removido**. Ele
deixou de ser incondicional e passou a significar o que sempre dizia: a
fonte não pôde ser consultada. É lançado quando o driver devolve
privilégio negado (1044, 1045, 1142, 1143), objeto inexistente (1049,
1054, 1146) ou falha de transporte (`ECONNREFUSED`, `ETIMEDOUT`,
`PROTOCOL_CONNECTION_LOST`, …). Continua sendo 503, continua acontecendo
dentro de `prepare` — antes de o lote abrir —, e continua nunca virando
lista vazia, `NOT_FOUND` ou lote `COMPLETED` sem usuários.

Erro de programação **não** entra nessa tradução: um `ER_PARSE_ERROR`
(1064) ou uma recusa da guarda `assertReadOnlySourceQuery` sobem cruos e
viram 500. Um 503 tranquilizador ali mandaria quem opera investigar o
Helpdesk por um defeito nosso.

### Divergência de ambiente que já custou caro uma vez

O schema `pctec_helpdesk` contém **cópias órfãs** de `clientes`,
`clientes_grupo`, `usuarios` e `usuario_modulos`, desatualizadas em
relação a `pctecdb` (em PRD: 69 contra 99 linhas em `clientes`). Não é
delas que o Helpdesk lê — o pool `pctecdb` do Helpdesk aponta para o
schema `pctecdb`. Qualquer consulta que esqueça de qualificar o schema
lê o cadastro errado sem erro nenhum.

## GRANTs mínimos da credencial

A credencial do assistente é isolada da credencial do catálogo do
Portal — são integrações diferentes, com ciclos de rotação diferentes.
O nome do principal difere por ambiente; o que importa é a forma da
concessão.

Ela precisa de **duas** concessões, ambas por coluna:

```sql
-- Empresas: registro autoritativo
GRANT SELECT (id, nome, tipo_doc, documento, ativo)
  ON <HELPDESK_REGISTRY_DB_NAME>.clientes
  TO '<principal>'@'<host>';

-- Usuários: schema do Helpdesk
GRANT SELECT (id, name, email, role, active, client_id)
  ON <HELPDESK_DB_NAME>.users
  TO '<principal>'@'<host>';
```

Nenhuma coluna de credencial é alcançada: `password`, `reset_token`,
`reset_expires` e `last_login` ficam fora da concessão. Essa é a segunda
das duas travas — a primeira é a projeção fechada no código — e nenhuma
delas confia na outra.

> **Estado por ambiente (2026-08-31).** Em DEV o principal já tem as
> duas concessões, por coluna, exatamente como acima. Em PRD a
> concessão sobre o schema do Helpdesk é ainda `GRANT SELECT ON
> <HELPDESK_DB_NAME>.*` — larga demais, porque alcança `password` e
> `reset_token`. Ela é **suficiente** para o assistente funcionar, então
> nada aqui depende de mudá-la; mas reduzi-la à forma acima é a
> pendência de segurança registrada. O teste de integração
> *"a credencial não alcança as colunas de credencial de `users`"* é o
> que torna essa redução verificável em vez de prometida.

Os GRANTs antigos sobre a tabela local de empresas podem ser revogados
quando alguém confirmar que nenhum outro consumidor depende deles.
