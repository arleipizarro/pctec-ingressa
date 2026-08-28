# Fonte Helpdesk — contrato atual do assistente de importação

> Estado em 2026-08-28. Este documento descreve **de onde** o assistente
> de importação lê, **por quê**, e **o que está bloqueado**.

## Resumo

| o que | de onde vem hoje | estado |
|---|---|---|
| Empresas | `HELPDESK_REGISTRY_DB_NAME`.`clientes` | **funcionando** |
| Documento (CNPJ) | mesma projeção, coluna `documento` + `tipo_doc` | **funcionando** |
| Usuários | — | **BLOQUEADO** (`HELPDESK_USER_SOURCE_UNAVAILABLE`) |

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

## Usuários — bloqueado, e por quê

**A importação automática de usuários continuará bloqueada até que o
Helpdesk conclua a migração da sua autoridade de usuários.**

O registro de usuários **não** foi migrado junto com o de empresas. O
código vivo do Helpdesk continua tratando a sua tabela local `users`
como autoridade:

- a autenticação procura lá (`routes/auth.js`);
- `role`, `client_id`, `client_group_id` e `active` são lidos e
  atualizados lá (`routes/users.js`).

Essa tabela não existe mais no servidor.

`helpdesk_usuarios` **não é a substituta**, e isto foi verificado, não
suposto:

- ela aparece em **um único ponto** de todo o backend do Helpdesk: um
  `INSERT IGNORE` que grava apenas `(usuario_id, role, active)`;
- **nenhum `SELECT`** do Helpdesk a consulta;
- ela **nunca recebe `client_id`** — e `client_id` é o único vínculo
  cadastral que autoriza a importação de um usuário para uma empresa.

Adotá-la como fonte inventaria uma autoridade que o sistema de origem
não reconhece, e produziria um importador que compila, passa em teste e
importa quase ninguém de verdade.

### A recusa é explícita, nunca uma lista vazia

Quando a etapa de usuários é alcançada, o conector recusa na fronteira
com `HELPDESK_USER_SOURCE_UNAVAILABLE` (HTTP **503**).

Esta é a distinção que o desenho protege: *"não consegui perguntar"* e
*"perguntei e não há ninguém"* levam a ações opostas. A segunda leitura
convida quem opera a concluir a importação sem usuários, ou a
recadastrá-los à mão — decisões tomadas sobre uma informação que ninguém
verificou. Por isso a condição **nunca** aparece como lista vazia,
`NOT_FOUND`, 404, ou lote `COMPLETED` sem usuários.

A recusa acontece dentro de `prepare`, que roda **antes** de o lote ser
aberto: nenhuma organização, nenhum vínculo e nenhum usuário chegam a
ser escritos, e não fica lote `RUNNING` órfão nem lote `FAILED` que
sugira tentativa.

### O que continua funcionando

Nada que não dependa desta fonte foi afetado: catálogo de empresas,
catálogo do Portal, correspondência por CNPJ, confirmação manual,
reconciliação e o vínculo automático da criação manual de organização.

### Como desbloquear

Quando o Helpdesk publicar um registro de usuários consultável — com
`client_id` mantido —, o desbloqueio é uma implementação de
`readUsersByIds`/`readUsersByClientId` sobre aquele contrato, e a
remoção da recusa. Nada mais no assistente precisa mudar.

## GRANTs mínimos da credencial

A credencial do assistente é `pctec_helpdesk_ingressa_ro@127.0.0.1`,
isolada da credencial do catálogo do Portal — são integrações
diferentes, com ciclos de rotação diferentes.

Ela precisa de **uma** concessão, por coluna, no registro autoritativo:

```sql
GRANT SELECT (id, nome, tipo_doc, documento, ativo)
  ON <HELPDESK_REGISTRY_DB_NAME>.clientes
  TO 'pctec_helpdesk_ingressa_ro'@'127.0.0.1';
```

Nenhuma coluna de credencial é alcançada — o registro guarda cadastro,
não senha. Os GRANTs antigos sobre a tabela local podem ser revogados
quando alguém confirmar que nenhum outro consumidor depende deles; este
PR não os toca.
