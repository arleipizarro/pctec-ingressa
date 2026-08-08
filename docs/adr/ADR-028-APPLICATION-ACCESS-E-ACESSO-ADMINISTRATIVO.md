# ADR-028 — Application Access e Acesso Administrativo

## Contexto

A ADR-027 (Fase A) resolveu como a primeira `Identity` fundacional da
plataforma nasce, sem depender de um `Actor` autenticado — mas deixou
explicitamente fora de escopo a Fase B: "um mecanismo real para conceder
acesso administrativo a uma aplicação". Até esta entrega, `Application` e
`ApplicationAccess` existiam apenas como conceitos documentados
(`MODELO-DE-DOMINIO.md`, seções 7 e 8), sem nenhuma linha de código.

Esta ADR resolve exclusivamente a Fase B: como conceder a primeira
concessão administrativa da plataforma — acesso global à própria aplicação
Ingressa, com um nível de acesso distinto de um acesso comum — sem violar
nenhuma decisão já aprovada (`Identity` não contém `is_admin`; autorização
em duas camadas, ADR-007; `ApplicationAccess` referencia `Identity`
diretamente, nunca `IdentityProfile`, ADR-025).

Não decide autenticação (Fase C do ADR-027), não decide revogação de
acesso, não decide um modelo de permissões finas para nenhum produto
consumidor, não expõe endpoint HTTP.

## Problema

Como conceder à Identity fundacional (ou a qualquer Identity) acesso
administrativo à própria plataforma Ingressa, sem introduzir uma coluna
`is_admin` em `Identity`, sem um `Actor` autenticado real para a primeira
concessão (mesmo problema estrutural do ADR-027, agora em `ApplicationAccess`
em vez de `Identity`), e sem misturar essa decisão com permissão fina de
negócio (vedada pelo ADR-007)?

## Decisão sobre ADMIN — accessProfile é coerente com o modelo aprovado

**Extensão real e formal do modelo, não uma leitura implícita.** O modelo
documentado até esta entrega (`MODELO-DE-DOMINIO.md`, seção 8, v0.3.0) só
previa `status` (`GRANTED`/`REVOKED`) em `ApplicationAccess` — puro
entra/não entra, sem nenhuma noção de perfil. Esta ADR estende
formalmente esse modelo, adicionando `accessProfile`.

**Por que isso não viola "ApplicationAccess nunca contém regras de
permissão fina" (invariante já registrada):**

`accessProfile` distingue **nível de acesso GLOBAL à própria aplicação**
— não decide "o que o usuário pode fazer dentro do produto" no sentido do
ADR-007. A distinção-chave:

| | Pertence a `ApplicationAccess` (Ingressa) | Pertence ao produto consumidor |
|---|---|---|
| "Esta identidade pode entrar em `PCTEC_INGRESSA`?" | Sim — `status = GRANTED` | — |
| "Com que nível global ela entra — administração da plataforma ou uso comum?" | Sim — `accessProfile` | — |
| "Pode fechar um chamado, editar um item de patrimônio, aprovar um recebimento?" | Não | Sim |

`accessProfile = ADMIN` responde apenas "esta identidade administra a
própria plataforma Ingressa como um todo" — não responde nenhuma pergunta
sobre regras internas de um produto consumidor. Continua sendo uma decisão
binária-estendida (GRANTED com perfil X, ou não GRANTED), não uma matriz de
permissões.

**Por que não `is_admin`/`admin boolean` em `Identity` (vetado
explicitamente pela task e coerente com decisões já aprovadas):**
`Identity` representa quem a entidade é, nunca o que ela pode acessar
(ver `IDENTITY-DOMAIN-DESIGN.md`, seção 15, "O que não pertence ao
domínio"). Um booleano de administração em `Identity` misturaria
identidade com autorização — exatamente o que `ApplicationAccess` existe
para separar.

**Por que não `role` diretamente em `Identity`:** mesmo motivo — `role`
implicaria autorização acoplada à raiz de identidade, não à relação com
uma aplicação específica. `accessProfile` vive em `ApplicationAccess`
precisamente porque é uma propriedade da concessão de acesso a uma
aplicação, não da identidade em si.

**Enum fechado, não string livre.** `AccessProfile` (Value Object) aceita
hoje exclusivamente `ADMIN` — não um enum genérico aberto a qualquer
valor. Novos perfis exigem nova decisão formal (extensão do Value Object +
`ALTER TABLE` na coluna `ENUM('ADMIN')` de `application_accesses`), nunca
uma string arbitrária aceita silenciosamente.

## Decisão sobre a primeira concessão administrativa

**Mesmo padrão estrutural do ADR-027, replicado deliberadamente:**

1. `BootstrapFirstApplicationAccessService` (Application Service dedicado,
   implementado nesta entrega) concede `ApplicationAccess` com
   `accessProfile = ADMIN` para a aplicação `PCTEC_INGRESSA` a uma
   `Identity` existente, informada pelo operador (`identityPublicId`,
   nunca hardcoded).
2. `ApplicationAccess.grantFoundationalAdminAccess()` — método estático
   novo e isolado, paralelo a `Identity.createFoundational()` — produz o
   par que o bootstrap exige: `grantedByIdentityPublicId = undefined`
   (⇒ `NULL` na persistência) e o evento de domínio com `actorPublicId`
   fixado no marcador reservado `"BOOTSTRAP"`.
3. Um named lock MariaDB
   (`pctec_ingressa_application_access_bootstrap`) + a verificação "não
   existe outro `ApplicationAccess ADMIN` ativo para `PCTEC_INGRESSA`"
   impede uma segunda concessão administrativa — mesmo princípio do guard
   `COUNT(identities) = 0` do ADR-027, adaptado: aqui a invariante mais
   forte é "existe ADMIN concedido para esta aplicação?", não "existe
   qualquer `ApplicationAccess`?" (pois, diferente de `Identity`, esperamos
   que existam futuramente `ApplicationAccess` não-ADMIN sem que isso
   afete o guard administrativo).
4. Um segundo guard, mais específico, verifica duplicidade exata
   (identidade, aplicação, perfil) — redundante nesta fatia (só existe uma
   `Application` alvo de ADMIN), mantido pela robustez a extensões futuras
   e por exigência explícita da task desta entrega.
5. Toda a operação roda sobre uma única conexão física:
   `GET_LOCK` → `BEGIN` → `SELECT Application` → `SELECT Identity` →
   verificar ausência de `ADMIN` já concedido → `INSERT ApplicationAccess`
   → `INSERT AuditEvent` → `COMMIT` → `RELEASE_LOCK` → `connection.release()`
   — provado por teste de sequência explícito (não só inspeção de
   código).
6. `UnitOfWork` genérico **não é usado** — mesmo motivo do ADR-027: o
   named lock precisa permanecer adquirido até depois do `COMMIT`, nunca
   antes.

## `Application` — modelo mínimo e seed técnico

`Application` é, nesta fatia, somente-leitura no domínio (`reconstitute()`,
sem `create()`) — a Application `PCTEC_INGRESSA` é criada por seed técnico
de migration (`0007_seed_pctec_ingressa_application`), não por comando de
domínio. Justificativa: `Application` é metadado técnico estável da
plataforma (catálogo), análogo a schema, não dado pessoal operacional —
consistente com a preferência já expressa na task desta entrega. Um
comando de criação dinâmica (`CreateApplication`) fica para quando o
catálogo precisar de gestão via API/CLI, fora do escopo desta entrega.

`code` e `public_id` da Application `PCTEC_INGRESSA` são centralizados em
`src/modules/application/domain/value-objects/ApplicationCodes.ts` — nunca
espalhados como string mágica pelo código. `public_id` é técnico
determinístico (UUID fixo, gerado uma única vez, documentado), não gerado
em runtime — necessário para que o CLI de bootstrap e testes de integração
possam referenciar essa Application sem depender de uma consulta prévia
não determinística, e para garantir o mesmo valor entre ambientes.

## Migrations

**Três migrations, não uma** — descoberto durante a implementação: o
`MigrationRunner` já existente (v0.4.2) exige exatamente uma instrução SQL
executável por arquivo (`assertSingleStatement`), reforçado tanto em
código quanto em teste de auditoria estrutural. Uma migration combinada
(`CREATE TABLE applications` + `CREATE TABLE application_accesses` +
`INSERT` de seed) violaria essa regra já estabelecida. Dividida em:

- `0005_create_applications` — `CREATE TABLE applications`.
- `0006_create_application_accesses` — `CREATE TABLE application_accesses`
  (depende de `0005` e de `identities`, via `FOREIGN KEY`).
- `0007_seed_pctec_ingressa_application` — `INSERT` normal. Idempotência
  não é responsabilidade deste SQL (ver seção "Estratégia de seed e
  idempotência" abaixo).

Convenção `id BIGINT` interno + `public_id CHAR(36)` externo (ADR-021),
aplicada às duas tabelas novas — mesma divergência já registrada e aceita
da convenção histórica de `MODELO-RELACIONAL-PROPOSTO.md` v0.2.0.

**`DELETE FROM` no down da migration de seed:** exceção pontual e
documentada à convenção geral de nunca usar `DELETE FROM` em migrations —
reverter um `INSERT` de seed exige, por definição, um `DELETE`. Restrito
exclusivamente à linha semeada (`WHERE public_id = '<valor fixo>'`), nunca
um `DELETE` genérico por `code`. Nunca aplicável a `identities` (dado
pessoal, ADR-020) nem a `application_accesses` (histórico de auditoria de
acesso).

**Nenhuma migration foi executada nesta entrega.**

## Estratégia de seed e idempotência (revisão crítica antes do commit)

**Correção de desenho:** a primeira versão da migration `0007` usava
`INSERT IGNORE` como mecanismo de "idempotência". Isso foi identificado
como incorreto na revisão final e corrigido antes do commit: `INSERT
IGNORE` não apenas evita duplicidade — ele **mascararia silenciosamente**
qualquer divergência de estado pré-existente (ex.: uma linha com `code =
'PCTEC_INGRESSA'` mas `public_id` diferente do esperado, por alguma
intervenção manual anterior), permitindo que a migration fosse registrada
como aplicada com sucesso sobre um schema semanticamente incorreto.

**Estratégia correta, adotada:**

1. `applications.public_id` é técnico e determinístico (ver seção
   "`Application` — modelo mínimo e seed técnico" acima) — sempre o mesmo
   valor fixo.
2. `applications.code` tem `UNIQUE KEY uk_applications_code`;
   `applications.public_id` tem `UNIQUE KEY uk_applications_public_id`.
3. **A idempotência operacional é responsabilidade do
   `MigrationRunner`/`schema_migrations`, não do SQL da migration.** Uma
   migration cujo `id` já consta em `schema_migrations` nunca é
   reexecutada (`MigrationRunner.applyPending`) — por isso o `INSERT` de
   `0007` não precisa (e não deve) se defender contra reexecução própria.
4. O `INSERT` em `0007_seed_pctec_ingressa_application.up.sql` é,
   portanto, um `INSERT` **normal** — nenhuma cláusula de "ignorar
   duplicidade" (`INSERT IGNORE`), "substituir linha existente"
   (`REPLACE INTO`) ou "atualizar em caso de choque de chave" (`ON
   DUPLICATE KEY UPDATE`) é usada. Qualquer conflito real com as `UNIQUE
   KEY` acima (linha pré-existente divergente) faz este `INSERT` **falhar
   explicitamente**, interrompendo o `MigrationRunner` antes de registrar
   `0007` como aplicada — sinalizando corretamente que o schema precisa
   de investigação manual, em vez de prosseguir sobre uma divergência não
   resolvida.
5. O `down.sql` continua removendo exclusivamente a linha pelo
   `public_id` técnico fixo — nunca por `code` isolado (análise de risco
   completa no próprio arquivo `.down.sql`, inalterada nesta revisão).

## Erros

Formalizados em `docs/03-dominio/APPLICATION-ACCESS-DESIGN.md` (catálogo
próprio deste bounded context, não misturado a
`IDENTITY-DOMAIN-ERRORS.md`, que é especificamente do domínio `identity`):
`APPLICATION_NOT_FOUND`, `IDENTITY_NOT_FOUND` (reaproveitado
conceitualmente, implementado como classe própria neste módulo para não
criar dependência de código entre bounded contexts além do necessário),
`APPLICATION_ACCESS_ALREADY_GRANTED`,
`APPLICATION_ACCESS_BOOTSTRAP_ALREADY_COMPLETED`,
`APPLICATION_ACCESS_LOCK_NOT_ACQUIRED`, `APPLICATION_ACCESS_INVALID_PROFILE`.

## Eventos

`application-access.granted` já existia, conceitualmente, em
`CATALOGO-DE-EVENTOS.md` desde a v0.2.0 — **reutilizado, não duplicado**,
com o payload estendido para incluir `access_profile` (extensão
formalizada nesta ADR, não presente na definição original). Nenhum evento
novo foi criado.

## Garantias de unicidade do ADMIN — o que é real e o que não é

A invariante "não pode existir outro `ApplicationAccess ADMIN` ativo para
`PCTEC_INGRESSA`" é garantida por camadas **diferentes**, com força
**diferente** — nenhuma delas sozinha é uma garantia absoluta e universal.
Registrado aqui de forma explícita, sem sobre-representar nenhuma camada:

### A) O que é garantido pelo banco (schema)

**Nada além de unicidade de `public_id`.** A tabela
`application_accesses` (migration `0006`) tem:

- `UNIQUE KEY uk_application_accesses_public_id (public_id)` — cada linha
  tem um identificador único (trivial, não impede duplicidade lógica).
- `KEY idx_app_access_app_profile_status (application_public_id,
  access_profile, status)` — um índice **comum**, não `UNIQUE`. Acelera a
  consulta do guard (`existsGrantedByApplicationAndProfile`), mas **não
  impede** duas linhas com `application_public_id` e `access_profile`
  iguais e `status = GRANTED` simultaneamente.

**Não existe nenhuma constraint no banco que, por si só, impeça dois
`ApplicationAccess ADMIN` ativos para a mesma aplicação.** Mesma
limitação já registrada em `MODELO-RELACIONAL-PROPOSTO.md` para
`application_access` desde a v0.2.0 (índice único condicional não é
nativo no MariaDB sem coluna gerada) — decisão consciente de não
improvisar essa constraint (task v0.5.0, seção 15).

### B) O que é garantido pelo Application Service

Dentro de **uma única execução** de
`BootstrapFirstApplicationAccessService.execute()`, o guard
(`existsGrantedByApplicationAndProfile`) roda **dentro da mesma
transação**, antes do `INSERT` — então, para essa execução isolada, o
serviço nunca insere um segundo `ADMIN` se a checagem já encontrar um
`GRANTED` existente. Isso é um clássico padrão "check-then-act": correto
*sequencialmente*, mas **não garante nada sozinho contra duas execuções
verdadeiramente concorrentes** — ver C.

### C) O que é garantido apenas pelo named lock cooperativo

**A prevenção real de duas execuções concorrentes inserirem dois `ADMIN`
depende exclusivamente do named lock**
(`GET_LOCK('pctec_ingressa_application_access_bootstrap', ...)`). Esse
lock é **cooperativo**: só protege processos que efetivamente tentam
adquiri-lo antes de agir. Enquanto uma execução mantém o lock (do
`GET_LOCK` ao `RELEASE_LOCK`), qualquer segunda chamada ao mesmo serviço
bloqueia (ou expira em 10s) antes de sequer começar a checar — eliminando
a corrida "check-then-act" **dentro deste fluxo específico**.

**Concorrência fora do CLI/bootstrap — avaliação explícita:** esta
garantia via lock cooperativo protege **exclusivamente** chamadas que
passam por `BootstrapFirstApplicationAccessService`. Não existe, nesta
entrega, nenhum outro caminho de código que insira em
`application_accesses` — mas se um comando futuro (ex.: um eventual
`grant(actor, ...)` genérico, explicitamente fora de escopo desta
entrega) inserir uma linha em `application_accesses` **sem** adquirir o
mesmo lock nomeado, nada — nem o banco (A), nem esse serviço (B) — impede
uma segunda concessão `ADMIN` de coexistir com a primeira. Isso é uma
**decisão arquitetural consciente desta entrega**, não uma omissão: o
lock cooperativo foi considerado suficiente porque, hoje, o único
caminho de escrita para `application_accesses` é este serviço. Qualquer
extensão futura que adicione um segundo caminho de escrita precisará
decidir explicitamente se reusa este lock, se introduz uma constraint de
banco (índice único condicional via coluna gerada, ou aplicação de regra
em outra camada), ou se aceita o risco — não deve simplesmente presumir
que a proteção já existe de forma universal.

**Resumo em uma frase:** a invariante é sólida hoje porque o único
caminho de escrita passa pelo lock; ela deixa de ser sólida automaticamente
se um segundo caminho de escrita for adicionado sem replicar essa mesma
proteção — isso precisa ser lembrado explicitamente na próxima fatia que
tocar `application_accesses`.



- Comando de revogação (`RevokeApplicationAccess`) — não implementado.
- Concessão por um `Actor` autenticado real (`grant(actor, ...)`) — não
  implementada; só o caminho de bootstrap existe nesta fatia.
- Qualquer endpoint HTTP para `Application`/`ApplicationAccess`.
- Mudança de `Identity.status` ou `loginEnabled` como efeito de conceder
  acesso administrativo — nenhum dos dois é alterado por este mecanismo,
  confirmado por teste.
- `Credential`/autenticação — inalterado, nenhuma criada.

## Status

Aprovada tecnicamente pelo Product Owner e pelo Platform Architect —
v0.5.0, Administrative Access Foundation. Implementado em código
(`BootstrapFirstApplicationAccessService`,
`ApplicationAccess.grantFoundationalAdminAccess()`, CLI
`bootstrap:first-admin-access`, migrations 0005–0007, catálogo de erros
formalizado) — não executado ainda contra o MariaDB DEV real, nenhuma
concessão real efetuada.
