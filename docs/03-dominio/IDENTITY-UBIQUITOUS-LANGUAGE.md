# Linguagem Ubíqua — Identity

Versão associada: v0.3.0 — Identity Core (documental)
Status: Proposto para revisão do Product Owner e do Platform Architect

Este documento define com precisão os termos do bounded context `identity`.
Ele é referência obrigatória para qualquer documento, código, commit,
issue ou conversa técnica sobre este domínio. Divergência de nomenclatura
em relação a este glossário deve ser tratada como um erro a corrigir, não
como uma alternativa válida.

---

## Identity

**Definição:** entidade digital reconhecida pela Plataforma PCTEC,
existindo independentemente de login, senha, aplicação, organização,
sessão ou acesso. É o Aggregate Root do diretório de entidades (ver
ADR-017).

**Exemplos:** uma pessoa cadastrada como colaborador antes de ter acesso a
qualquer sistema; um cliente convidado que ainda não ativou login.

**Termos proibidos ou ambíguos:** "usuário" e "user" não devem ser usados
como sinônimo de `Identity` em código, banco ou documentação técnica —
"usuário" sugere uso de um sistema específico, o que contraria o princípio
de que `Identity` existe independentemente de aplicação. Ver também Actor.

**Contexto de uso:** toda vez que o domínio se referir a "quem é
reconhecido pela plataforma", o termo correto é `Identity`.

## Human Identity

**Definição:** subtipo de `Identity` cujo `Identity Type` é `HUMAN` —
representa uma pessoa física. É o único subtipo implementado no MVP
funcional (ver ADR-018).

**Exemplos:** um colaborador, um cliente, um parceiro — todos são `Human
Identity` no MVP; a diferença entre eles não é atributo de `Identity`, é a
classificação relacional do `Membership` correspondente (`EMPLOYEE`,
`CUSTOMER`, `PARTNER`; ver nota em `Identity Profile`, ADR-025).

**Termos proibidos ou ambíguos:** não confundir "Human Identity" com a
classificação relacional de `Membership` — o primeiro descreve a natureza
da entidade (é uma pessoa, atributo de `Identity`), o segundo descreve o
contexto de relação dela com uma organização específica (colaborador,
cliente etc., atributo do vínculo, não da identidade).

**Contexto de uso:** usado quando é necessário deixar explícito que a
identidade referenciada é de uma pessoa, em contraste com os demais tipos
reservados (`SERVICE`, `APPLICATION`, `DEVICE`, `AGENT`).

## Identity Type

**Definição:** Value Object que classifica a natureza da `Identity`.
Valores previstos: `HUMAN`, `SERVICE`, `APPLICATION`, `DEVICE`, `AGENT`.
Apenas `HUMAN` é implementado no MVP.

**Exemplos:** `HUMAN` para uma pessoa; `SERVICE` (reservado, não
implementado) para uma conta técnica futura.

**Termos proibidos ou ambíguos:** não usar "tipo de usuário" como
sinônimo — reforça a confusão com "usuário" já vetada em `Identity`.

**Contexto de uso:** atributo obrigatório de toda `Identity`, presente
desde a criação.

## Identity Status

**Definição:** Value Object que representa o estado de ciclo de vida da
`Identity`. Valores: `PENDING`, `ACTIVE`, `BLOCKED`, `INACTIVE`, `DELETED`
(ver ADR-019).

**Exemplos:** uma identidade recém-criada, aguardando ativação, está
`PENDING`; uma identidade bloqueada por segurança está `BLOCKED`.

**Termos proibidos ou ambíguos:** `Identity Status` não deve ser confundido
com `Login Enabled` — são dimensões independentes (ver `Login Enabled`
abaixo).

**Contexto de uso:** toda transição de estado de `Identity` é expressa
como mudança de `Identity Status`, nunca como exclusão física ou
recriação.

## Identity Profile (removido do bounded context `identity` — ADR-025)

**Nota de correção:** `Identity Profile`, como conceito do bounded context
`identity`, foi removido por ADR-025. `EMPLOYEE`, `CUSTOMER`, `PARTNER` e
`SUPPLIER` não são características intrínsecas de uma `Identity` — são
classificações que dependem da relação entre a `Identity` e uma
`Organization` específica (a mesma `Identity` pode ser `EMPLOYEE` na
Organização A e `CUSTOMER` na Organização B, simultaneamente).

Essas classificações passam a pertencer ao contexto do `Membership`
(bounded context `organization`/`access`), sob o nome provisório
`MembershipProfile`. Este glossário (`identity`) não define o desenho
definitivo de `MembershipProfile` — atributos, invariantes, comandos e
eventos ficam para a especificação própria daquele bounded context, fora
do escopo desta entrega.

**Termos proibidos ou ambíguos:** não usar `Identity Profile` como termo
vigente do bounded context `identity` — o termo permanece aqui apenas como
registro histórico da correção. Não reintroduzir `IdentityProfile` como
atributo, comando ou evento de `Identity` sem nova decisão formal que
reverta ADR-025.

## Login Enabled

**Definição:** atributo booleano de `Identity`, independente de `Identity
Status`, que indica se a identidade está habilitada a autenticar. A
autenticação só é permitida quando `Identity Status = ACTIVE` **e**
`Login Enabled = true` (ver ADR-011 e ADR-019).

**Exemplos:** um colaborador pré-cadastrado, `ACTIVE`, mas com `Login
Enabled = false`, ainda não pode fazer login.

**Termos proibidos ou ambíguos:** não tratar `Login Enabled = true` como
sinônimo de "identidade ativa" — uma identidade `BLOCKED` pode
tecnicamente ter `Login Enabled = true` armazenado, mas a autenticação
ainda assim é negada, pois a checagem considera as duas dimensões (ver
`IDENTITY-DOMAIN-DESIGN.md`, invariantes).

**Contexto de uso:** usado exclusivamente para a checagem de elegibilidade
de autenticação, nunca como substituto de `Identity Status`.

## Public ID

**Definição:** identificador único, imutável, sem significado de negócio,
que representa a `Identity` para qualquer consumidor externo (API, evento,
log, URL). Formato: UUID textual, coluna `CHAR(36)` (ver ADR-021).

**Exemplos:** `550e8400-e29b-41d4-a716-446655440000`.

**Termos proibidos ou ambíguos:** não confundir com `Internal ID`. Nenhum
documento, contrato de API ou evento deve usar o termo "ID" de forma
ambígua quando os dois existem — sempre especificar `public_id` ou `id`
(interno) explicitamente.

**Contexto de uso:** todo contrato externo, todo evento de domínio, toda
referência de `Identity` feita por outro bounded context ou produto
consumidor.

## Internal ID

**Definição:** chave primária interna de `Identity`, numérica
(`BIGINT UNSIGNED`), usada apenas para eficiência de armazenamento e
integridade referencial dentro do próprio banco `pctec_ingressa`. Nunca
exposta (ver ADR-021).

**Exemplos:** `48291` (valor ilustrativo).

**Termos proibidos ou ambíguos:** nunca chamar o `Internal ID` de "ID
público" ou usá-lo em qualquer resposta de API, token, URL, log de
consumidor ou payload de evento.

**Contexto de uso:** exclusivamente em chaves estrangeiras internas ao
banco de dados do Ingressa.

## Normalized Email

**Definição:** forma canônica do e-mail de uma `Identity`, usada
exclusivamente para comparação de unicidade case-insensitive (ver Value
Object `NormalizedEmail`). Não é um campo que o usuário edita diretamente —
é derivado do e-mail informado.

**Exemplos:** `Pessoa@Exemplo.com` e `pessoa@exemplo.com` normalizam para
o mesmo valor de comparação.

**Termos proibidos ou ambíguos:** não confundir `Normalized Email` com o
e-mail de exibição — o valor normalizado é para comparação/unicidade, o
valor original (com capitalização do usuário) pode ser preservado para
exibição, conforme detalhado no Value Object.

**Contexto de uso:** verificação de unicidade na criação e na alteração de
e-mail.

## Normalized CPF

**Definição:** forma canônica do CPF de uma `Identity` (somente dígitos,
sem pontuação), usada para comparação de unicidade quando o CPF é
informado. CPF é opcional.

**Exemplos:** `123.456.789-00` normaliza para `12345678900`.

**Termos proibidos ou ambíguos:** CPF nunca é usado como `Public ID` nem
exposto integralmente em eventos, logs ou payloads voltados a
consumidores.

**Contexto de uso:** verificação de unicidade condicional (apenas quando
informado) na criação e alteração de identidade.

## Activation

**Definição:** processo pelo qual uma `Identity` em `PENDING` recebe sua
primeira `Credential` e transita para `ACTIVE`, mediado por um `MagicLink`
do tipo `ACTIVATION` consumido com sucesso. Não envolve senha provisória
(ver ADR-012).

**Exemplos:** colaborador recebe um link expirável, define sua senha ao
clicar, e a identidade passa a `ACTIVE`.

**Termos proibidos ou ambíguos:** `Activation` não é sinônimo de `Login
Enabled = true` — são eventos relacionados, mas conceitualmente distintos;
ativação trata da transição de estado e da primeira credencial, não da
habilitação de login em si (embora normalmente ocorram em conjunto).

**Contexto de uso:** exclusivamente para o fluxo de primeira credencial
associado à transição `PENDING → ACTIVE`.

## Anonymization

**Definição:** procedimento controlado que substitui os dados pessoais
identificáveis de uma `Identity` (nome, e-mail, CPF) por valores não
reversíveis, preservando apenas `Public ID` e histórico estrutural
necessário para integridade referencial e auditoria. Distinto de
`Logical Deletion` (ver ADR-020).

**Exemplos:** atendimento a um pedido legal de eliminação de dados
pessoais.

**Termos proibidos ou ambíguos:** não usar "exclusão" como sinônimo de
`Anonymization` — exclusão lógica (`Logical Deletion`) e anonimização são
comandos e eventos distintos.

**Contexto de uso:** apenas em processos de conformidade legal explicitamente
acionados, nunca como consequência automática de outra transição.

## Logical Deletion

**Definição:** transição de `Identity Status` para `DELETED`, sem remoção
física de dados. Estado terminal, sem transição operacional de volta (ver
ADR-019, ADR-020).

**Exemplos:** encerramento definitivo de relação com uma identidade que não
deve mais existir operacionalmente, preservando histórico para auditoria.

**Termos proibidos ou ambíguos:** não confundir com `INACTIVE` — inatividade
é reversível pelo fluxo comum; `DELETED` não é.

**Contexto de uso:** comando `LogicallyDeleteIdentity`, evento
`identity.deleted`.

## Credential Reference

**Definição:** forma pela qual `Identity` se relaciona com `Credential`
sem incorporá-la ao próprio agregado — uma referência lógica por
`Public ID`, não uma composição interna (ver ADR-017, ADR-022).

**Exemplos:** ao processar autenticação, o bounded context `security`
consulta a `Identity` correspondente por `Public ID`, mas `Identity` não
carrega nem expõe os dados de `Credential`.

**Termos proibidos ou ambíguos:** não modelar `Credential` como
subentidade de `Identity` em nenhum diagrama ou schema.

**Contexto de uso:** ao descrever a relação entre os bounded contexts
`identity` e `security`.

## Actor

**Definição:** quem realiza uma ação de domínio sobre uma `Identity` —
pode ser a própria identidade (autoatendimento), outra identidade
(administração) ou um `System Actor`. Todo comando que altera `Identity`
de forma relevante exige um actor identificado, para fins de auditoria.

**Exemplos:** um administrador que bloqueia uma identidade é o `Actor` da
transição `ACTIVE → BLOCKED`.

**Termos proibidos ou ambíguos:** `Actor` não é sinônimo de "usuário
logado" no sentido de sessão de aplicação consumidora — é o conceito de
domínio que responde "quem fez isso", registrado por `Public ID`.

**Contexto de uso:** presente em todo comando de domínio como
`created_by_identity_public_id`, `updated_by_identity_public_id`,
`deleted_by_identity_public_id`, e em `actor_public_id` nos eventos.

## System Actor

**Definição:** valor reservado de `Actor` usado quando uma ação é
disparada por um processo automatizado do próprio sistema (ex.: expiração
automática de `MagicLink`, rotina de reconciliação), sem uma `Identity`
humana responsável direta pela ação específica.

**Exemplos:** uma rotina batch que marca identidades `PENDING` expiradas há
mais de um prazo definido como `INACTIVE` (se tal regra vier a existir —
hoje **Pendente de decisão**) usaria `System Actor` como `Actor`.

**Termos proibidos ou ambíguos:** `System Actor` não substitui a exigência
de auditoria — a ação ainda é registrada, apenas com um actor
identificado como sistêmico em vez de humano.

**Contexto de uso:** exclusivamente em processos automatizados internos ao
domínio, nunca como valor padrão de conveniência para evitar identificar um
actor humano real.
