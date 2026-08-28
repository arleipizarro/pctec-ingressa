# Vínculo administrativo de organizações ao Portal

Como uma COMPANY passa a ser visível para o PCTEC Portal — e por que o
CLI deixou de ser o caminho cotidiano.

## O que o vínculo é

`OrganizationExternalReference(PCTEC_PORTAL, clientes, legacyId)` resolve
uma COMPANY do Ingressa para uma linha de `pctecdb.clientes`. Sem ela, o
Portal autentica a pessoa, resolve o contexto organizacional e falha em
toda tela comercial: não há como escopar as consultas dele.

Regras estruturais, não convenções:

- **uma COMPANY, um cliente legado.** A invariante de banco é "no máximo
  uma referência ACTIVE por (systemCode, entityType, legacyId)"
  (`uk_org_ext_ref_active_match`, migration 0013);
- **um BUSINESS_GROUP nunca tem referência própria.** A visão consolidada
  é a soma das referências das empresas filhas. Dar ao grupo uma
  referência sua criaria uma segunda fonte de verdade para o mesmo
  número, e as duas divergiriam na primeira entrada ou saída de empresa;
- **`clientes_grupo` nunca é usado** para produzir contexto comercial
  (decisão fechada no piloto AFIP).

## Pela tela

`Organizações → (abrir a empresa) → Integração com o Portal`.

- **COMPANY não vinculada** — botão “Vincular ao Portal”, e então
  sugestão automática por CNPJ e/ou busca do cliente por nome ou
  documento, com seleção explícita e confirmação. O campo cru de id não
  existe mais (ver “Correspondência automática por CNPJ”, adiante). O
  aviso diz o alcance: o vínculo vale para **todos** os usuários do
  Portal daquela empresa e **não pode ser trocado nem revogado** por
  esta tela.
- **COMPANY vinculada** — estado, id do cliente e `publicId` técnico da
  referência. Nenhuma ação de troca, revogação ou exclusão: elas não
  existem no servidor nesta fatia.
- **BUSINESS_GROUP** — cobertura (`vinculadas / total de empresas
  ativas`) e a lista das empresas pendentes, cada uma com link para a
  própria tela. Nunca um campo de id: grupo não tem `clientes.id`.

## O gate do provisionamento

`Novo usuário` com `PCTEC_PORTAL` selecionado exige cobertura:

| organização | exigência | código de recusa |
|---|---|---|
| COMPANY | referência `PCTEC_PORTAL`/`clientes` ACTIVE | `PORTAL_ORGANIZATION_REFERENCE_REQUIRED` |
| BUSINESS_GROUP | todas as empresas ativas vinculadas, e ao menos uma ativa | `PORTAL_GROUP_REFERENCE_INCOMPLETE` |

A recusa acontece **antes da transação de provisionamento**: nenhuma
Identity, Membership, ApplicationAccess ou convite chega a existir. A
tela bloqueia o botão pelo mesmo motivo, mas a autoridade é o servidor —
um POST direto na rota recebe a mesma recusa.

Aplicações que não são o Portal (`PCTEC_HELPDESK`, `PCTEC_INGRESSA`,
qualquer outra) seguem sem exigência nenhuma, e a cobertura sequer é
consultada.

## Atomicidade — como a regra "uma COMPANY, um cliente" é imposta

A `UNIQUE KEY uk_org_ext_ref_active_match` (migration 0013) cobre
`(system_code, entity_type, legacy_id)`. Ela impede **duas organizações**
de reivindicarem o mesmo `clientes.id` — e é só isso. Ela **não** impede
a mesma organização de ganhar duas referências ACTIVE com `legacyId`
diferentes.

Por isso a operação inteira acontece numa **transação só**:

1. `SELECT ... FOR UPDATE` na linha da **Organization**. É o único
   registro que já existe antes da escrita e que todos os concorrentes
   daquela empresa têm em comum. O InnoDB serializa ali — e só ali:
   empresas diferentes seguem em paralelo;
2. **depois** do bloqueio, a leitura das referências ACTIVE, sem
   `LIMIT`. A ordem importa: um `SELECT ... FOR UPDATE` não é leitura
   consistente e não fixa o snapshot da transação, então a leitura
   seguinte enxerga o que o concorrente comitou enquanto se esperava;
3. a escrita, pelo serviço oficial de criação montado sobre
   `ExistingConnectionUnitOfWork` — dentro da MESMA transação, com o
   Aggregate, o evento e a auditoria de sempre.

Quem serializa é o banco, e não a memória de um processo: o bloqueio vale
entre **todos os chamadores desta operação** — inclusive processos Node
distintos e réplicas da API ligadas ao mesmo MariaDB.

**Nenhuma migration nova**: uma restrição global sobre
`(organization_public_id, system_code, entity_type)` resolveria a corrida
e proibiria, de quebra, mapeamentos muitos-para-um legítimos de outros
sistemas, que o modelo permite de propósito.

### O que o bloqueio NÃO cobre

O `FOR UPDATE` só é adquirido por quem executa esta operação. O CLI
genérico escreve por outro caminho, **não adquire este bloqueio** e
continua podendo criar uma segunda referência ACTIVE com `legacyId`
diferente para a mesma organização — nada no banco o impede.

O bloqueio elimina a corrida entre requisições desta operação; ele não é
uma invariante do banco. Contra o cadastro ambíguo que o CLI ainda
alcança, a defesa é a detecção fail-closed descrita a seguir: leitura
administrativa, criação de vínculo e provisionamento recusam em vez de
escolher.

Prova: `LinkPortalOrganizationReference.concurrency.integration.test.ts`
dispara duas chamadas simultâneas **desta operação**, em conexões
diferentes, para a mesma COMPANY com `legacyId` diferentes — e exige uma
criação, uma recusa e um único evento de auditoria.

## Cadastro ambíguo

Mais de uma referência ACTIVE `PCTEC_PORTAL`/`clientes` na mesma
organização. Não deveria existir, e é alcançável: o CLI genérico continua
podendo criar qualquer par, não passa pelo bloqueio desta operação, e a
UNIQUE KEY não cobre essa chave.

Nesse estado, **nada escolhe por você**:

- a leitura administrativa marca `ambiguous: true`, devolve
  `reference: null` e **lista** as referências em `ambiguousReferences`;
- a criação de vínculo é recusada com `PORTAL_REFERENCE_AMBIGUOUS` (409)
  — inclusive quando o `legacyId` pedido é um dos que já existem, porque
  tratar isso como idempotência seria eleger uma das duas;
- o provisionamento com `PCTEC_PORTAL` é recusado com o mesmo código,
  antes de abrir transação;
- a tela mostra os vínculos lado a lado e orienta a encerrar o incorreto
  — nunca a criar mais um.

Num grupo, uma empresa ambígua não conta como vinculada nem como
faltando: o grupo deixa de estar coberto até alguém decidir.

Corrigir exige encerrar a referência incorreta, hoje só pelo CLI, com
registro.

## Códigos de erro do vínculo

| código | HTTP | quando |
|---|---|---|
| `PORTAL_REFERENCE_LEGACY_ID_INVALID` | 422 | `legacyId` não é inteiro positivo |
| `PORTAL_REFERENCE_COMPANY_REQUIRED` | 422 | tentativa em BUSINESS_GROUP |
| `PORTAL_REFERENCE_ORGANIZATION_NOT_ACTIVE` | 422 | organização INACTIVE |
| `PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND` | 404 | organização inexistente |
| `PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT` | 409 | a empresa já aponta para outro `legacyId` |
| `PORTAL_REFERENCE_AMBIGUOUS` | 409 | a organização tem mais de uma referência ACTIVE |
| `ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS` | 409 | esse `legacyId` já pertence a outra empresa |

Repetir o **mesmo** vínculo responde **200** com `alreadyLinked: true` —
nada é escrito e nenhum evento novo é gravado, inclusive quando as duas
requisições chegam simultaneamente: a segunda espera no bloqueio, relê e
encontra a referência recém-criada.

## O CLI

`bootstrap-organization-external-reference` continua existindo, correto e
inalterado. Ele permanece como ferramenta de exceção — carga inicial,
recuperação, sistemas e entidades que a tela deliberadamente não expõe
(a rota administrativa fixa `PCTEC_PORTAL`/`clientes` e não aceita
outros valores). Para vínculos novos no dia a dia, use a tela.

## O que ainda não existe

Revogar, trocar e excluir um vínculo. O modelo prevê `SUPERSEDED`, mas
nenhum comando de domínio faz essa transição hoje; implementá-la junto
com a tela significaria inventar a regra de sucessão no mesmo movimento.
Enquanto isso, um vínculo errado é corrigido pelo CLI, com registro.

## Correspondência automática por CNPJ

Entregue. O administrador **não precisa mais conhecer nem consultar
`pctecdb.clientes.id`** — nem para vincular uma empresa nova, nem para
reconciliar as que já existem.

### A regra, inteira

CNPJ normalizado (só dígitos, exatamente 14), comparado por
**igualdade** dos dois lados. Quatro resultados possíveis:

| resultado | significado | vincula? |
|---|---|---|
| `EXACT_UNIQUE` | exatamente 1 cliente **ativo** com o mesmo CNPJ | **sim** (com confirmação) |
| `NOT_FOUND` | nenhum cliente, ativo ou não, tem este CNPJ | não |
| `AMBIGUOUS` | mais de um cliente **ativo** | não — fail-closed |
| `INACTIVE_ONLY` | o CNPJ existe no Portal, mas só em cliente inativo | não — fail-closed |
| `DOCUMENT_MISSING_OR_INVALID` | a organização não tem CNPJ comparável | não |

**Cliente inativo nunca é candidato.** `clientes.ativo = 0` é o Portal
dizendo que aquele cadastro saiu de operação; vincular uma empresa a ele
daria a ela um contexto comercial morto, e o vínculo não tem desfazer. A
exclusão acontece **antes da contagem** — por isso um ativo convivendo
com um inativo de mesmo CNPJ é `EXACT_UNIQUE`, e não ambiguidade: existe
exatamente um candidato.

`INACTIVE_ONLY` é estado próprio, e não `NOT_FOUND`, porque as ações são
diferentes: "não existe lá" pede cadastro no Portal; "existe e está
inativo" pede reativação. Dizer "não encontrado" mandaria cadastrar uma
segunda vez a mesma empresa — criando exatamente a duplicidade que
produz `AMBIGUOUS`.

A busca administrativa **continua mostrando os inativos**, identificados
e sem seletor: escondê-los faria alguém procurar em vão um cadastro que
existe. A proibição de verdade está no servidor (ver adiante), não no
React.

**Nunca por nome.** Não há `LIKE`, distância de edição nem prefixo no
caminho automático. Razão social e nome fantasia divergem entre
sistemas, se repetem entre filiais e mudam sem aviso — um match por nome
erra em silêncio, e o erro só aparece quando alguém lê o faturamento da
empresa errada.

**Nunca `LIMIT 1`.** A consulta por CNPJ não tem limite: a contagem é o
que separa `EXACT_UNIQUE` de `AMBIGUOUS`, e um limite transformaria
duplicidade em vínculo silencioso para a primeira linha que o motor
devolvesse.

**CPF nunca entra.** `pctecdb.clientes` guarda CPF e CNPJ na mesma
coluna `documento`, com `tipo_doc ENUM('CPF','CNPJ')`. A consulta filtra
`tipo_doc = 'CNPJ'`, e a normalização exige 14 dígitos.

A decisão mora num lugar só — `MatchPortalClientByDocumentService` — e é
chamada de três: a criação manual, a sugestão da tela e a reconciliação.

### Dois caminhos de vínculo, e por que são dois

| rota | quando | consulta o Portal? |
|---|---|---|
| `POST /admin/organizations/:publicId/portal-reference` (PR #19) | vínculo **operacional**, por `legacyId` já conhecido | **não** — e é isso que a mantém utilizável com a fonte fora do ar |
| `POST /admin/portal-catalog/organizations/:publicId/link` | vínculo **confirmado a partir do catálogo** | **sim** — relê o cliente imediatamente antes de escrever |

A tela nova usa **sempre** a segunda. O motivo é preciso: quando o
`legacyId` veio de uma lista que esta própria API montou, aceitá-lo de
volta sem reconferir é tratar a resposta anterior como autoridade. Entre
a busca e o clique existe uma janela — o cliente pode ser desativado ou
removido no Portal — e é nessa janela que um vínculo irreversível
nasceria para um cadastro que já não serve.

A releitura recusa com códigos próprios:

| código | HTTP | quando |
|---|---|---|
| `PORTAL_CATALOG_LEGACY_ID_INVALID` | 422 | o corpo não traz um inteiro positivo |
| `PORTAL_CATALOG_CLIENT_NOT_FOUND` | 404 | o cliente sumiu entre a busca e a confirmação |
| `PORTAL_CATALOG_CLIENT_INACTIVE` | 409 | o cliente foi inativado entre a busca e a confirmação |

O corpo carrega **só `legacyId`**. Nome, CNPJ, status e qualquer outro
dado comercial que venham junto são descartados na fronteira — não há
onde recebê-los no contrato do serviço, e o que a resposta diz sobre o
cliente vem da releitura, nunca do pedido. `systemCode` e `entityType`
seguem fixos no servidor.

### A escrita continua sendo a mesma

Nenhum caminho novo escreve referência. Todos passam pelo
`LinkPortalOrganizationReferenceService` deste documento, com o
`SELECT ... FOR UPDATE`, a releitura pós-bloqueio, a idempotência, o
`PORTAL_REFERENCE_AMBIGUOUS` e a auditoria oficial. A correspondência
decide **se** e **com qual `legacyId`** chamá-lo; ela não sabe escrever.

### Pela tela

**Empresa não vinculada.** O campo cru "ID do cliente no Portal" não
existe mais. No lugar:

1. ao abrir, a tela consulta a correspondência por CNPJ. Havendo
   `EXACT_UNIQUE`, mostra o cliente (nome + CNPJ mascarado) e um botão
   de confirmação. **A sugestão não vincula sozinha**: o vínculo não tem
   desfazer nesta tela, e uma correspondência exata ainda depende de os
   dois cadastros estarem certos;
2. em qualquer estado, há busca por nome, nome fantasia ou CNPJ. A busca
   textual **mostra** candidatos; ela nunca vincula, nem quando devolve
   um resultado só;
3. o `legacyId` só existe como consequência de um resultado
   **selecionado explicitamente** — e a confirmação passa pela rota que
   relê o cliente na fonte, nunca pela rota operacional;
4. clientes **inativos aparecem** na busca, identificados e sem seletor.
   Some da lista, alguém procuraria em vão um cadastro que existe;
   selecionável, viraria um vínculo irreversível para um cadastro morto.

Trocar e revogar continuam sem caminho, como antes.

**Grupo.** Igual: cobertura e empresas pendentes, nunca campo de id e
nunca vínculo próprio.

**Criação de empresa.** O formulário ganhou um campo de CNPJ, opcional.
Vazio, a empresa é criada normalmente; **preenchido e incompleto,
bloqueia o envio** — descartá-lo em silêncio criaria a empresa sem
documento enquanto quem opera acredita tê-lo informado, e o sintoma só
apareceria depois, como um vínculo que nunca acontece. O servidor
continua sendo a autoridade e recusa documento inválido recebido
diretamente (`ORGANIZATION_DOCUMENT_NUMBER_INVALID`).

Com CNPJ, a correspondência é tentada logo depois de a organização ser
criada — **fora da transação dela**. A empresa e a associação ao GRUPO
são uma transação só; a integração com o Portal acontece **depois** e
**não desfaz** a criação da empresa. Uma indisponibilidade do Portal não
pode desfazer um cadastro que já é válido: a empresa nasce, e o vínculo
é uma segunda decisão, que pode ficar pendente. A resposta separa os
dois fatos (`publicId` e `portalIntegration`), e a tela de destino
explica o que aconteceu.

### Reconciliação das organizações existentes

`Organizações → Reconciliar com o Portal`. Duas etapas separadas:

- **dry-run** (`GET`): classifica as COMPANY ACTIVE e mostra contagens
  por estado e as candidatas (`publicId`, nomes, estado, sugestão com
  CNPJ **mascarado** do cliente). **Não escreve nada** — nem referência,
  nem lote, nem evento. O método é parte do contrato: um `POST` diria
  que algo acontece;
- **execução** (`POST`, com guarda de origem): exige a palavra literal
  `RECONCILIAR` e a lista explícita de organizações. Não existe
  "reconciliar tudo". Cada organização é **reclassificada do zero** —
  o dry-run é uma fotografia — e só `EXACT_UNIQUE` chega a escrever.
  Uma transação por organização: a falha de uma não altera as outras, e
  o resultado diz, organização por organização, o que aconteceu.

Nenhuma consulta ou `INSERT` manual em lugar nenhum deste caminho.

### O catálogo do Portal

Adapter **somente leitura** no Ingressa, no mesmo padrão isolado da
fonte Helpdesk: pool próprio, credencial própria, projeção fechada
(`id, nome, nome_fantasia, tipo_doc, documento, ativo`), guarda de SQL
que recusa qualquer coisa que não seja um `SELECT` sobre `clientes`, e
nenhum método de escrita na classe. `portal_acesso` e `clientes_grupo`
estão explicitamente fora do alcance.

`pctecdb.clientes.documento` é `VARCHAR(20)` **sem índice**, e guarda o
CNPJ **mascarado** (as migrations do Portal fazem
`WHERE documento = '13.356.779/0001-24'`). A normalização acontece dentro
do `SELECT`, dos dois lados, ao custo de uma varredura de uma tabela
pequena. **Nenhum índice é criado no banco do Portal** — este conector
não altera nada lá.

O que sai na resposta HTTP é `legacyId`, nome, nome fantasia e a
**máscara** `**.***.678/0001-95`. Nunca o documento inteiro, nunca
telefone, e-mail, endereço ou qualquer coluna comercial.

### Sem configuração da fonte

As rotas de `/api/v1/admin/portal-catalog` respondem **503** com
`PORTAL_CATALOG_SOURCE_NOT_CONFIGURED`. Não derrubam o boot e não somem:
login, `/admin/organizations` e **o vínculo manual pelo `legacyId`**
continuam funcionando. A criação de empresa responde
`portalIntegration.status = SOURCE_NOT_CONFIGURED` — que é diferente de
`NOT_FOUND`: ninguém chegou a perguntar ao Portal, e afirmar
"não encontrado" seria relatar um fato não verificado.

### Configuração operacional

Arquivo próprio, fora do repositório, permissão 600, carregado pelo Node
via `--env-file`:

`/app/.config/pctec-ingressa/portal-source.env`

| variável | |
|---|---|
| `PORTAL_SOURCE_DB_HOST` | |
| `PORTAL_SOURCE_DB_PORT` | |
| `PORTAL_SOURCE_DB_NAME` | |
| `PORTAL_SOURCE_DB_USER` | |
| `PORTAL_SOURCE_DB_PASSWORD` | |

Sem default nenhum: faltando qualquer uma, o catálogo não sobe (503) e
nada é lido. Nenhuma variável `DB_*` do Ingressa é reaproveitada —
herdá-las faria o catálogo ler o banco do Ingressa e não achar cliente
nenhum, transformando "configuração ausente" em "conectou no lugar
errado".

A credencial apontada ali precisa ser **dedicada e somente leitura**
sobre `clientes` do banco do Portal. Nada neste módulo escreve lá, e a
separação de pools garante que uma escrita do Ingressa nunca saia por
essa conexão.

### O CNPJ no importador do Helpdesk

Verificado contra a fonte real, e o achado importa:

- `pctec_helpdesk.clients` **tem** a coluna `cnpj` (`VARCHAR(20)`);
- a credencial read-only do Ingressa **não a alcança**: o GRANT é
  `SELECT (id, name, active)`, e pedir `cnpj` responde
  `ERROR 1143 ... for column 'cnpj' in table 'clients'`.

Então, hoje, **a fonte não fornece CNPJ ao Ingressa**. O importador está
preparado para os dois mundos: ele lê o documento numa consulta própria
e isolada, trata a negativa de privilégio como "a fonte não fornece"
(nunca como falha, que derrubaria o APPLY inteiro por um campo
opcional), e transporta o CNPJ até `Organization.documentNumber` quando
ele vem. **Nome nunca é usado como substituto.**

Ampliar o GRANT (`SELECT (id, name, active, cnpj)`) é decisão de quem
administra o banco do Helpdesk, não deste código. Feita a mudança, nada
mais precisa ser alterado no Ingressa.

O documento é lido **só no APPLY**, e não em `prepare`: ele não muda
decisão nenhuma do plano, e incluí-lo faria um CNPJ corrigido no
Helpdesk entre o dry-run e o apply mudar o `scopeFingerprint` — punindo
uma correção que não altera nada do que vai ser escrito.

### O importador vincula, e não deixa a conta para depois

Depois que o APPLY termina — organização **e** usuários comitados — o
assistente chama o **mesmo**
`AutoLinkPortalOrganizationReferenceService` da criação manual e da
reconciliação. Não há cópia da regra de CNPJ dentro do importador: ele
manda o `publicId` da organização e o ator, e traduz a resposta. Se a
regra mudar, muda num lugar só.

A chamada acontece **fora** do `try` que marca o lote como `FAILED`, e
numa conexão/banco diferentes: nenhuma transação atravessa Helpdesk,
Portal e Ingressa, e uma indisponibilidade do Portal não desfaz uma
importação válida nem contamina o lote.

Serve tanto à organização recém-criada quanto à que já existia e foi
resolvida pelo APPLY sem referência do Portal.

O resultado do APPLY ganhou `portalIntegration` — **aditivo**, `null` em
DRY_RUN, e consumidores anteriores o ignoram:

| estado | o que aconteceu | o que fazer |
|---|---|---|
| `LINKED` | vinculada agora | nada |
| `ALREADY_LINKED` | já apontava para o mesmo cliente | nada, e nada foi escrito |
| `PENDING_DOCUMENT` | a organização não tem CNPJ comparável | cadastrar o CNPJ, ou selecionar na tela |
| `PENDING_NOT_FOUND` | o CNPJ não existe no Portal | cadastrar a empresa no Portal |
| `PENDING_INACTIVE` | existe no Portal, mas inativo | reativar lá |
| `PENDING_AMBIGUOUS` | mais de um cliente ativo com o CNPJ | resolver a duplicidade no Portal |
| `SOURCE_NOT_CONFIGURED` | a fonte não foi sequer consultada | configurar `portal-source.env` |
| `FAILED` | falha técnica ou recusa do vínculo | ver `reasonCode` |

Cinco fatos distintos — fonte não consultada, cliente inexistente,
cliente inativo, ambiguidade e falha técnica — com estados distintos.
Tratá-los como um só faria alguém cadastrar de novo, no Portal, uma
empresa que já está lá.

Reexecutar o APPLY é idempotente: a organização já vinculada ao mesmo
cliente responde `ALREADY_LINKED`, sem nova escrita e sem evento novo.

Nem documento integral, nem credencial, nem configuração da fonte, nem
mensagem de driver entram no lote, na resposta ou no log — `reasonCode`
é sempre código estável.

A reconciliação continua existindo, e agora para o que ela sempre foi:
as organizações anteriores a esta fatia, e as que ficaram pendentes por
um motivo que só quem opera pode resolver.
