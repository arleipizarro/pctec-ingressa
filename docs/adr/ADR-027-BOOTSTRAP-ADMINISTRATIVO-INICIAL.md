# ADR-027 — Bootstrap Administrativo Inicial

## Nota de revisão (v0.5.0 Slice 2, terceira rodada — implementação concluída)

O mecanismo desenhado nas rodadas anteriores desta ADR foi **implementado
em código** nesta rodada. Decisões abaixo estão FECHADAS, não mais
propostas:

- `BootstrapFirstIdentityService` (Application Service dedicado) foi
  implementado — `CreateIdentityService` **não** é reutilizado (motivo
  confirmado por auditoria de código, não só por análise teórica: ver
  "`CreateIdentityService` — reavaliação").
- `Identity.createFoundational()` é a extensão localizada de domínio
  escolhida e implementada — método novo, isolado, `Identity.create()`
  e todos os comandos de mutação existentes permanecem intocados.
- `IdentityRepository.countAll()` é o guard de leitura escolhido e
  implementado.
- `UnitOfWork` genérico (`MariaDbUnitOfWork.runInTransaction`) **não é
  usado** — motivo: ele faz `commit()` só depois que o callback `work()`
  retorna, e o named lock precisa permanecer adquirido até **depois** do
  `COMMIT` (nunca antes) para proteger a janela entre a leitura de
  `COUNT` e a durabilidade do `INSERT`. Reaproveitar `runInTransaction`
  forçaria `RELEASE_LOCK` a rodar dentro de `work()`, antes do commit
  automático — uma corrida real. `BootstrapFirstIdentityService` orquestra
  a conexão/transação diretamente por este motivo.
- Toda a operação usa uma única conexão física, na ordem: `GET_LOCK` →
  `BEGIN` → `COUNT` → `INSERT Identity` → `INSERT AuditEvent` → `COMMIT`
  → `RELEASE_LOCK` → `connection.release()` — implementada e **provada
  por teste explícito de sequência** (não só por inspeção de código; ver
  relatório da entrega para os testes exatos).
- `identities.created_by_identity_public_id = NULL`,
  `audit_events.actor_public_id = "BOOTSTRAP"`, `loginEnabled = false`,
  `type = HUMAN` — todos implementados e confirmados por teste,
  inspecionando os parâmetros posicionais exatos do `INSERT`.
- Nenhuma `Credential`/`ApplicationAccess` é criada — confirmado por
  teste (nenhuma SQL relacionada a essas tabelas é executada).
- A migration `actor_type` em `audit_events` continua **adiada**, não
  implementada — permanece dívida consciente registrada (ver seção "Gap
  real de schema").

## Nota de revisão (v0.5.0 Slice 2, segunda rodada)

Esta ADR foi revisada após a primeira rodada de aprovação parcial. Três
correções materiais desta rodada, detalhadas nas seções correspondentes:

1. **Nenhum marcador (`"BOOTSTRAP"`/`"SYSTEM"`) é persistido em campo
   semanticamente destinado a `public_id` de `Identity`**
   (`identities.created_by_identity_public_id`) — esse campo é `NULL`
   para a Identity fundacional. A auditoria representa o bootstrap por
   outro meio — ver seção "Actor de bootstrap e auditoria", que inclui
   um **gap real de schema** encontrado ao auditar `AuditEvent`.
2. **O one-shot guard não depende de um marcador de `created_by`** — usa
   `COUNT(identities) = 0` sob um named lock MariaDB, dentro da mesma
   conexão/transação — ver seção "One-shot guard".
3. **Esta ADR não afirma que a Identity fundacional é "administradora"**
   — separa explicitamente Fase A (esta ADR) de Fases B/C/D (futuras,
   fora de escopo) — ver seção "Fases".
4. **A reutilização de `CreateIdentityService`/`Identity.create()` não é
   integral** — auditado e corrigido nesta rodada; ver seção
   "CreateIdentityService — reavaliação".

## Contexto

O PCTEC Ingressa é a fonte única de identidade da plataforma (ADR-001).
Toda criação/mutação relevante de `Identity` exige um `Actor` identificado
(Linguagem Ubíqua, termo `Actor`; `ActorPublicId.required()` já lança
`ACTOR_REQUIRED` na ausência de um). Isso cria um problema estrutural
irredutível: **a primeira `Identity` da plataforma não pode ser criada por
nenhum `Actor` autenticado, porque nenhum existe ainda** — não há login
(ADR-011/ADR-022), não há `Credential`, não há `Session`, não há JWT, e a
API `POST /api/v1/identities` (ainda não implementada) não pode ser exposta
publicamente sem autenticação.

Esta ADR resolve exclusivamente esse ponto de partida — o "bootstrap da
raiz de confiança" — e produz **a primeira Identity fundacional**, não um
administrador funcional (ver "Fases" abaixo). Não decide autenticação, não
decide autorização fina, não implementa `POST /api/v1/identities`, não cria
a primeira `Credential`.

## Problema

Como nasce a primeira `Identity` da plataforma se ainda não existe uma
`Identity` autenticada capaz de atuar como `Actor`?

## Alternativas consideradas

### A. CLI administrativo de bootstrap, execução local, one-shot

Um comando (`npm run bootstrap:admin`, executado apenas no servidor, via
terminal local) que cria a primeira `Identity`, protegido por named lock +
verificação de que nenhuma `Identity` existe. Nunca abre HTTP.

**Segurança:** alta — nenhuma superfície de rede exposta.
**Auditabilidade:** alta — ver seção "Actor de bootstrap e auditoria".
**Simplicidade:** alta, com a ressalva da seção "CreateIdentityService —
reavaliação" (não é reuso 100% gratuito, mas é a opção de menor
superfície nova).
**Reversibilidade:** alta — nenhuma migration obrigatória para o
mecanismo em si (uma migration futura *opcional* é discutida na seção de
auditoria, para representação completa).
**Operação:** compatível com o modelo operacional já existente.

### B. Token de bootstrap de uso único (via HTTP)

**Rejeitada** — mantém superfície HTTP mesmo temporária, contrariando a
exigência de nunca expor endpoint sem autenticação.

### C. Seed/migration de administrador

**Rejeitada** — migrations descrevem schema, não dado pessoal
operacional; confunde schema evolution com bootstrap.

### D. INSERT administrativo manual

**Rejeitada** — pula domínio, eventos, invariantes e auditoria.

### E. Alternativa superior

Nenhuma identificada além dos refinamentos desta rodada de revisão
(named lock em vez de marcador; `NULL` em vez de marcador falso).

## Decisão

**Adotada a Opção A: bootstrap via CLI local, one-shot, protegido por
named lock MariaDB e pela invariante "nenhuma Identity existe ainda".**

1. Um CLI (`npm run bootstrap:first-identity`, **implementado nesta
   entrega** — `src/cli/bootstrap-first-identity.ts`) cria exatamente
   **uma** `Identity` fundacional — não um administrador (ver "Fases").
2. `identities.created_by_identity_public_id = NULL` para essa Identity —
   nunca um marcador fingindo ser um `public_id`.
3. A auditoria representa o bootstrap por um mecanismo distinto de
   `created_by_identity_public_id` — ver "Actor de bootstrap e
   auditoria" (inclui gap de schema a resolver em migration futura).
4. Um named lock MariaDB + `COUNT(identities) = 0` impede um segundo
   bootstrap — ver "One-shot guard".
5. `loginEnabled = false`, sempre, nunca configurável pelo operador do
   CLI — ver "loginEnabled".

## Actor de bootstrap e auditoria

### Auditoria da estrutura real de `AuditEvent`

Estrutura de domínio (`backend/src/modules/audit/domain/AuditEvent.ts`):

```ts
actorPublicId: string   // NOT NULL, sem "actor_type" companion
```

Schema real (`0003_create_audit_events.up.sql`):

```sql
actor_public_id  VARCHAR(36)  NOT NULL
  COMMENT 'public_id do actor, ou o marcador reservado SYSTEM.'
```

**Respostas às perguntas da revisão:**

- **Existe `actor_type`?** Não. Nenhuma coluna equivalente existe em
  `audit_events` nem no tipo `AuditEvent` do domínio.
- **Existe `actor_public_id`?** Sim.
- **É nullable?** Não — `NOT NULL` no schema real.
- **O schema atual consegue representar `BOOTSTRAP` sem mentir?**
  **Parcialmente.** A coluna já foi desenhada, por comentário explícito,
  para aceitar um "marcador reservado" além de um `public_id` real
  (`"SYSTEM"` já é esse precedente, em uso desde a v0.4.0). Um segundo
  marcador reservado (`"BOOTSTRAP"`) é consistente com esse desenho
  **especificamente nesta coluna** — ela nunca alegou ser uma FK estrita
  para `identities.public_id`; seu próprio comentário já previa valores
  não-Identity. Isso é diferente de `identities.created_by_identity_public_id`,
  cujo nome e propósito são estritamente "qual Identity criou esta
  linha" — persistir um marcador ali seria, sim, uma mentira (exatamente
  o que a correção 1 desta rodada elimina).
- **`IdentityCreated` (`identity.created`) já é suficiente como evento de
  domínio?** Sim — ver decisão abaixo.

### Gap real de schema — registrado para migration futura, não implementado agora

Apesar do precedente do marcador em `actor_public_id`, a representação
**preferida** pelo Platform Architect (`actor_type = BOOTSTRAP`,
`actor_identity_public_id = NULL`) **não existe hoje**: não há coluna
`actor_type`, e `actor_public_id` não é nullable. Para ter essa
representação de forma limpa (sem depender de um valor de string
reservado fazendo dupla função de "tipo" e "identificador"), seria
necessária uma migration futura adicionando:

```sql
-- Proposta, NÃO implementada nesta entrega:
ALTER TABLE audit_events
  ADD COLUMN actor_type ENUM('IDENTITY','SYSTEM','BOOTSTRAP') NOT NULL DEFAULT 'IDENTITY',
  MODIFY COLUMN actor_public_id VARCHAR(36) NULL;
```

**Decisão para esta entrega (sem migration):** manter `identity.created`
como único Domain Event — **não existe, e não é criado, nenhum evento
`InitialAdministratorBootstrapped` ou equivalente** (nenhuma duplicação
semântica; ver justificativa completa nesta seção) —, com

`actor_public_id = "BOOTSTRAP"` no evento/`AuditEvent` (reaproveitando o
precedente já estabelecido pelo marcador `"SYSTEM"` nessa MESMA coluna,
que já não pretende ser uma FK estrita) — e `identities.created_by_identity_public_id
= NULL` (nunca um marcador) na tabela `identities`, que é onde a
correção 1 desta rodada realmente importa. A migration acima fica
registrada como melhoria formal futura, não bloqueante, a ser avaliada
junto com a implementação real do CLI.

### Por que não uma Identity `SYSTEM`/`BOOTSTRAP` falsa

Sem alteração desta rodada: não há `FOREIGN KEY` entre
`created_by_identity_public_id` e `identities.public_id` — mas isso NUNCA
foi justificativa para inventar um valor lá que pareça uma Identity real.
`NULL` é a representação verdadeira ("nenhuma Identity criou esta linha")
e é o valor correto, já suportado pelo schema hoje sem qualquer migration.

### Por que não um `BootstrapPrincipal` separado do domínio Identity

Mantido: adicionaria um conceito de domínio novo sem necessidade — o
problema já é resolvido, para o evento/auditoria, pelo precedente do
marcador reservado em `audit_events.actor_public_id`, e para
`identities.created_by_identity_public_id`, por `NULL`. Nenhuma nova
abstração de domínio é necessária para isso especificamente.

## One-shot guard

**Implementado exatamente como segue** (`BootstrapFirstIdentityService`):

```
1. Obter UMA conexão do pool (mesma conexão para todos os passos seguintes
   — mesma lição já aplicada em MigrationRunner: lock e trabalho protegido
   pelo lock precisam estar na MESMA conexão física).
2. GET_LOCK('pctec_ingressa_identity_bootstrap', timeout) nessa conexão.
   - Lock não obtido → falha distinta: "outro processo de bootstrap está
     em execução" (concorrência em andamento, não bootstrap já concluído
     no passado — mensagens diferentes, não confundir os dois casos).
3. Dentro de uma transação nessa MESMA conexão:
   SELECT COUNT(*) AS total FROM identities;
   - total > 0 → BOOTSTRAP_ALREADY_COMPLETED (rollback, nunca insere).
4. total = 0 → criar a Identity fundacional (ver seção seguinte),
   inserir Identity + AuditEvent na mesma transação.
5. COMMIT.
6. RELEASE_LOCK no finally (mesma conexão), sempre — mesmo em erro.
7. Devolver a conexão ao pool.
```

**Por que `COUNT(identities) = 0` é uma regra MAIS FORTE que "nenhuma
Identity criada por bootstrap":**

1. **Não depende de nenhuma tag/marcador estar corretamente aplicado.**
   Um guard baseado em "existe uma Identity com `created_by = BOOTSTRAP`"
   depende de toda execução passada do CLI ter, de fato, gravado esse
   marcador corretamente — uma dependência de implementação frágil. `COUNT
   = 0` não depende de nenhum metadado específico ter sido escrito
   corretamente antes; é uma verificação estrutural direta sobre o estado
   real da tabela.
2. **O propósito do bootstrap é semanticamente "sou a primeira Identity
   de todas".** Se QUALQUER Identity já existe — não importa como ela
   nasceu — a raiz de confiança da plataforma já está estabelecida, e
   rodar o bootstrap de novo criaria ambiguidade sobre qual Identity é
   "a" fundacional. `COUNT = 0` captura exatamente essa invariante.
3. **É robusto a mudanças futuras de implementação.** Se amanhã o
   mecanismo de marcação do actor mudar (ex.: a migration proposta na
   seção anterior for aplicada), um guard baseado em `created_by =
   'BOOTSTRAP'` teria que ser reescrito; `COUNT(identities) = 0` continua
   válido, porque não depende de nenhum detalhe de como o actor é
   representado.

**Named lock como defesa de concorrência:** o `GET_LOCK` nomeado
(`pctec_ingressa_identity_bootstrap`) é especificamente a defesa contra
**duas execuções simultâneas do CLI** (dois operadores, ou o mesmo
operador em dois terminais) — sem o lock, ambas poderiam ler `COUNT = 0`
antes de qualquer uma commitar, resultando em duas Identities
"fundacionais". O lock, obtido antes da leitura e liberado só depois do
commit (na mesma conexão), serializa as duas tentativas — a segunda
sempre vê `COUNT = 1` (ou falha ao obter o lock, dependendo do timing),
nunca as duas commitam.

**Natureza cooperativa do lock — limite explícito.** `GET_LOCK` do
MariaDB é um lock **cooperativo** (também chamado "advisory lock"): ele só
protege quem efetivamente chama `GET_LOCK`/`RELEASE_LOCK` antes de agir.
Ele **não é** uma constraint de banco, `UNIQUE KEY` ou qualquer mecanismo
que impeça, no nível do servidor, um escritor que ignore o lock
deliberadamente (ex.: um script futuro que insira em `identities`
diretamente, sem passar pelo CLI de bootstrap). Isso é **aceitável nesta
fase**, não um descuido, pelos seguintes motivos:

1. Não existe hoje nenhum outro fluxo operacional de criação de
   `Identity` — nem `POST /api/v1/identities` (ainda não implementado),
   nem qualquer outro caminho autorizado. O único escritor real do
   comando `CreateIdentity` é o próprio CLI de bootstrap nesta fase.
2. Mesmo que o lock seja contornado por um escritor hipotético fora do
   mecanismo oficial, a invariante mais forte do guard —
   `COUNT(identities) = 0` — continua verdadeira independentemente do
   lock: assim que **qualquer** `Identity` existir na tabela (por
   qualquer via), o bootstrap fica permanentemente bloqueado, porque a
   checagem de contagem roda a cada tentativa, não depende de o lock ter
   sido respeitado por quem criou aquela linha.
3. Nenhuma tabela ou constraint nova é adicionada nesta ADR para reforçar
   isso de forma mais rígida (ex.: um `UNIQUE` sintético ou uma trigger)
   — o par lock cooperativo + `COUNT = 0` é considerado suficiente para
   o cenário real de uso (um operador humano, uma vez, via terminal
   local), sem introduzir complexidade de schema desproporcional ao
   risco.

## Fases — Identity fundacional × administrador real

**Correção central desta rodada: esta ADR não cria um administrador
funcional.** Ela cria a **primeira Identity fundacional da plataforma** —
nada além disso.

| Fase | O que entrega | Status |
|---|---|---|
| **A — Bootstrap da primeira Identity** | Uma `Identity` (`type=HUMAN`, `status=PENDING`, `loginEnabled=false`) existe no diretório mestre, com auditoria verdadeira do processo que a criou. | **Implementada nesta entrega** (`BootstrapFirstIdentityService` + CLI `bootstrap:first-identity`) — não executada contra o MariaDB DEV real ainda. |
| **B — `ApplicationAccess` administrativo** | Um mecanismo real para conceder acesso administrativo a uma aplicação (ADR-007) — hoje só conceitual, zero código. | **Fora de escopo** — dependência futura não resolvida por esta ADR. |
| **C — `Credential`/autenticação** | A Identity fundacional ganha uma forma de provar quem é (senha, magic link, etc.) — bounded context `security`, não implementado. | **Fora de escopo.** |
| **D — Primeiro login administrativo** | Alguém efetivamente autentica como a Identity fundacional E tem `ApplicationAccess` concedido a uma aplicação administrativa. Só é possível depois de B e C. | **Fora de escopo, depende de B e C.** |

O nome desta ADR ("Bootstrap Administrativo Inicial") descreve o
**procedimento operacional** (é a ação que, no fim das contas, existe
para eventualmente viabilizar administração da plataforma) — não afirma
que a Fase A, por si só, concede qualquer papel administrativo à Identity
criada. Nenhum documento desta entrega deve ser lido como "isto já cria
um admin".

## loginEnabled

Formalizado: a Identity fundacional nasce com `loginEnabled = false`,
pela mesma razão de qualquer Identity nova — não existe `Credential`
ainda (ADR-011/ADR-022). Isto já é uma invariante do domínio hoje
(`Identity.create()` fixa `loginEnabled: false` internamente — não é um
parâmetro exposto para o chamador escolher). **O CLI não deve, e
tecnicamente não pode, configurar `loginEnabled` manualmente** — nenhuma
alteração de domínio é necessária para garantir isso; é assim que
`Identity.create()` já funciona.

Quando `Credential`/autenticação existirem (Fase C), uma operação
explícita e separada (`EnableLogin`, já existente como comando de domínio
— `Identity.enableLogin()`) poderá habilitar login, respeitando as
invariantes já implementadas (ex.: idempotência já tratada — habilitar
login já habilitado não falha nem reemite evento).

## `CreateIdentityService` — reavaliação

**Correção desta rodada: a alegação anterior de reuso "integral" estava
errada.** Auditando `Identity.create()`:

```ts
createdByPublicId: props.actor,             // usado em identities.created_by_identity_public_id
...
identity.envelope(props.actor, ...)         // MESMO props.actor usado no Domain Event → audit_events.actor_public_id
```

**Hoje, um único valor de `actor: ActorPublicId` alimenta simultaneamente
dois destinos que esta ADR agora exige que sejam DIFERENTES para o caso
de bootstrap:** `identities.created_by_identity_public_id` (deve ser
`NULL`) e o `actor_public_id` do evento/auditoria (pode ser o marcador
`"BOOTSTRAP"`). Não é possível satisfazer os dois com o `CreateIdentityService`
e o `Identity.create()` de hoje, sem alguma mudança — mesmo pequena — no
tratamento do `actor` para este caso específico.

**Alternativas avaliadas:**

**A. `ActorContext` discriminado, propagado por todo o domínio Identity.**
Rejeitada como estava proposta — mudaria a assinatura de TODOS os
comandos de mutação de `Identity` (`activate`, `block`, `inactivate`,
`logicallyDelete`, etc., que hoje recebem `actor: ActorPublicId`
diretamente), uma superfície muito maior do que o problema exige (só a
criação, e só o caso de bootstrap, precisa dessa distinção — todo o
resto do ciclo de vida sempre opera sobre uma Identity que já existe, com
um actor real ou `SYSTEM`, nunca `BOOTSTRAP`).

**B. `BootstrapFirstIdentityService`, novo Application Service dedicado —
implementada.** Um serviço novo, separado de `CreateIdentityService`,
que orquestra o MESMO domínio e os MESMOS repositórios (`Identity`,
`IdentityRepository`, `AuditEventRepository`) — mas **não é um wrapper
trivial**: `Identity.createFoundational()` (novo método estático,
implementado) produz exatamente o par que faltava —
`createdByPublicId = undefined`, evento com `actorPublicId = "BOOTSTRAP"`
— sem tocar `Identity.create()` nem nenhum comando de mutação existente.
`UnitOfWork` genérico **não é usado** pelo serviço — ver nota da terceira
rodada, no topo deste documento, para o motivo exato (ordem
lock/commit).

**Decisão final: Opção B, implementada.** `ActorPublicId` **não foi**
estendido para representar não-Identities de forma genérica (preferência
do Platform Architect, mantida) — a divergência necessária foi resolvida
como um caso especial e localizado da criação
(`Identity.createFoundational()`), não uma mudança sistêmica de como
"actor" é representado em todo o domínio.

## Erros

| Código | HTTP conceitual | Classificação | Onde pertence |
|---|---|---|---|
| `BOOTSTRAP_ALREADY_COMPLETED` | 409 | Conflito | **Implementado** (`BootstrapAlreadyCompletedError`, `application/errors/BootstrapErrors.ts`) e **formalizado** no catálogo (`docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md`). Não é um erro de domínio do Aggregate `Identity` no sentido estrito — é um erro de **orquestração do processo de bootstrap**, mantido no catálogo `identity` por proximidade de bounded context. |
| `BOOTSTRAP_LOCK_NOT_ACQUIRED` | 409 | Conflito | **Implementado** (`BootstrapLockNotAcquiredError`) e **formalizado** no catálogo. Distinto de `BOOTSTRAP_ALREADY_COMPLETED`: concorrência em andamento, não bootstrap já concluído no passado. |
| `IDENTITY_CREATION_NOT_AUTHORIZED` | 403 | Autorização | Pertenceria à futura camada de autorização (Fase B/D — fora do domínio `identity` em sentido estrito, já que ADR-007 mantém autorização fora do núcleo `identity`). **Ainda proposto, não implementado, não decidido** — pertence ao futuro `POST /api/v1/identities` autenticado, fora do escopo desta entrega (que é só o CLI de bootstrap). |

**`IDENTITY_CREATION_NOT_AUTHORIZED` não é adicionado ao catálogo formal
(`IDENTITY-DOMAIN-ERRORS.md`) nesta entrega** — permanece como decisão
proposta nesta ADR, pendente de aprovação explícita antes de qualquer
implementação (pertence ao futuro `POST /api/v1/identities`, não a esta
entrega).

## Contrato futuro do POST — reafirmado

`POST /api/v1/identities` continua desenhado com `201 Created` +
`Location: /api/v1/identities/{publicId}`, reaproveitando o mesmo
`IdentityHttpMapper` já implementado para o `GET`. Nenhum actor é aceito
em payload ou header customizado — decisão já vigente desde a Vertical
Slice 1, reafirmada aqui.

**O endpoint permanece bloqueado até existirem, nesta ordem de
dependência:**

1. Um *authenticated principal* real (Fase C — `Credential`/autenticação).
2. Um *ActorContext* resolvido no Application Layer a partir desse
   principal (nunca a partir de header/payload do cliente).
3. Autorização apropriada decidindo se aquele actor pode criar `Identity`
   (Fase B/D).

Nenhuma dessas três dependências é resolvida por esta ADR.

## Consequências

- Nenhuma migration foi criada/executada nesta entrega. Uma migration
  futura **opcional** (`actor_type` em `audit_events`) fica registrada
  como melhoria proposta, não bloqueante — dívida consciente, não uma
  omissão.
- `identities.created_by_identity_public_id = NULL` para a Identity
  fundacional — implementado (`Identity.createFoundational()`), sem
  qualquer alteração de schema.
- `audit_events.actor_public_id = "BOOTSTRAP"` (marcador reservado,
  reaproveitando o precedente de `"SYSTEM"`) para o evento/auditoria da
  criação fundacional — implementado, sem alteração de schema.
- `BootstrapFirstIdentityService` e `Identity.createFoundational()` —
  implementados nesta entrega, testados (conexão única, ordem
  lock/transação, atomicidade, mensagens sanitizadas — ver relatório da
  entrega).
- `IdentityRepository.countAll()` — implementado, leitura pura.
- A Identity fundacional criada pela Fase A **não tem** autoridade
  administrativa — isso depende das Fases B, C e D, todas fora de
  escopo.
- `BOOTSTRAP_ALREADY_COMPLETED` e `BOOTSTRAP_LOCK_NOT_ACQUIRED` —
  implementados e formalizados no catálogo
  (`IDENTITY-DOMAIN-ERRORS.md`). `IDENTITY_CREATION_NOT_AUTHORIZED`
  permanece proposto, não implementado, não adicionado ao catálogo
  formal.

## Status

Aprovada tecnicamente pelo Product Owner e pelo Platform Architect —
v0.5.0, Vertical Slice 2. **Implementado em código**
(`BootstrapFirstIdentityService`, `Identity.createFoundational()`, CLI
`bootstrap:first-identity`, catálogo de erros formalizado) — não
executado ainda contra o MariaDB DEV real, nenhuma Identity real criada.
Terceira rodada de revisão.
