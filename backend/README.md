# PCTEC Ingressa — Backend

Backend do PCTEC Ingressa. Este README cobre o estado cumulativo até a
**v0.5.0 — Bootstrap da primeira Identity (Slice 2)**, que evolui a
**v0.5.0 — Identity API, Vertical Slice 1 (Identity Query API)**, a
correção de empacotamento/entrypoint da v0.4.2, a **v0.4.2 — MariaDB
Integration (preparação)**, a **v0.4.1 — Runtime Bootstrap** e a
**v0.4.0 — Identity Core, Vertical Slice 1** anteriores.

## v0.5.0 — Bootstrap da primeira Identity (Slice 2)

Resolve o problema de partida documentado em
[`docs/adr/ADR-027-BOOTSTRAP-ADMINISTRATIVO-INICIAL.md`](../docs/adr/ADR-027-BOOTSTRAP-ADMINISTRATIVO-INICIAL.md):
como nasce a primeira `Identity` da plataforma, se toda criação exige um
`Actor` autenticado e nenhum existe ainda?

### O que este CLI cria — e o que NÃO cria

Cria a **primeira Identity fundacional** da plataforma (`type=HUMAN`,
`status=PENDING`, `loginEnabled=false`) — nada além disso.
**Não cria um administrador funcional.** Não concede acesso a nenhuma
aplicação (`ApplicationAccess` não existe como código ainda). Não cria
`Credential`. Ver ADR-027, seção "Fases", para a separação completa
entre bootstrap (Fase A, esta entrega) e autoridade administrativa real
(Fases B/C/D, fora de escopo).

### Uso

```bash
npm run build
npm run bootstrap:first-identity
```

100% interativo — **nunca aceita argumento de linha de comando** (elimina
a classe de risco "segredo em `argv`/`ps`/histórico do shell"). Pede
nome completo, e-mail e CPF (opcional), mostra um resumo (CPF sempre
mascarado, só os 2 últimos dígitos) e exige digitar exatamente
`BOOTSTRAP` para confirmar — qualquer outra resposta cancela sem
nenhuma alteração.

Bloqueado em `NODE_ENV` fora de `development`/`test` (recusa
incondicional, exit code `2`) — produção exige uma decisão formal futura,
não implícita.

### Mecanismo de proteção (one-shot)

Named lock MariaDB (`GET_LOCK('pctec_ingressa_identity_bootstrap', ...)`)
+ `COUNT(identities) = 0` verificado dentro da mesma transação, na MESMA
conexão física do início ao fim — mesma lição já aplicada em
`MigrationRunner`. O lock é **cooperativo** (protege duas execuções
simultâneas do próprio CLI) — não é uma constraint de banco; isso é
aceitável nesta fase porque não existe nenhum outro fluxo de criação de
`Identity` ainda, e `COUNT(identities) = 0` continua bloqueando
permanentemente assim que qualquer `Identity` existir, por qualquer via
(ver ADR-027 para a justificativa completa).

### Auditoria

`identities.created_by_identity_public_id = NULL` para a Identity
fundacional — nunca um marcador fingindo ser um `public_id` real.
`audit_events.actor_public_id = "BOOTSTRAP"` (marcador reservado, mesmo
padrão já usado por `"SYSTEM"` nessa coluna) — nenhuma tabela nova, nenhum
evento de domínio novo (`identity.created` reaproveitado sem alteração).

### Por que não reaproveita `CreateIdentityService`

`CreateIdentityService` alimenta, com o mesmo valor de `actor`, tanto
`created_by_identity_public_id` (que precisa ser `NULL` no bootstrap)
quanto o `actor_public_id` do evento (que precisa ser `"BOOTSTRAP"`) — os
dois precisam divergir aqui. `BootstrapFirstIdentityService` é um
Application Service dedicado, usando `Identity.createFoundational()`
(extensão pequena e isolada do domínio — não toca `Identity.create()` nem
nenhum comando de mutação existente).

## v0.5.0 — Identity Query API (Slice 1)

Primeira API HTTP real do domínio Identity, provando a cadeia completa
**HTTP → Application → Domain → Repository → MariaDB**.

### Endpoint

```
GET /api/v1/identities/:publicId
```

**200 OK** — Identity encontrada:
```json
{
  "publicId": "6f1c9e2a-2222-4444-8888-000000000000",
  "type": "HUMAN",
  "fullName": "Nome Completo",
  "email": "pessoa@example.com",
  "status": "PENDING",
  "loginEnabled": false,
  "version": 1,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

**404** — `IDENTITY_NOT_FOUND` (nenhuma Identity com esse `publicId`).
**422** — `IDENTITY_PUBLIC_ID_INVALID` (`publicId` não é um UUID
sintaticamente válido).

Formato de erro (conforme `docs/02-arquitetura/API-CONTRACT-V1.md`):
```json
{
  "error": {
    "code": "IDENTITY_NOT_FOUND",
    "message": "Identidade não encontrada: ....",
    "correlation_id": "b3f2c1a0-....",
    "details": []
  }
}
```
Todo request/response inclui o header `X-Correlation-Id` (gerado
automaticamente se o cliente não enviar um).

### Campos deliberadamente NÃO expostos

`internalId` (BIGINT interno), `normalizedEmail`, `normalizedCpf`, `cpf`,
`createdByPublicId`/`updatedByPublicId`/`deletedByPublicId`/
`deletionReason`, e qualquer credencial (que nunca existiu no Aggregate
`Identity` — ADR-022). Ver `IdentityHttpMapper.ts` — é o único lugar que
decide o que sai para fora.

### Limitação de actor (decisão explícita desta fatia)

Esta é uma operação de **leitura pública por identificador** — não exige
`actor`. Isso é diferente de `CreateIdentity`, que sempre exige um
`ActorPublicId` para auditoria.

**Criação e mutação de Identity continuam bloqueadas** nesta fatia —
não existe `POST`/`PATCH`/`DELETE` em `/api/v1/identities`. Não foi
criado nenhum mecanismo temporário de actor (nenhum header tipo
`X-Actor-Id`/`X-User-Id`, nenhum `SYSTEM` actor artificial aceito via
HTTP) — essa decisão fica pendente de uma definição futura sobre
bootstrap/autenticação, deliberadamente fora do escopo desta entrega.

### A API ainda não é pública

**O Nginx de DEV continua expondo somente `/health`.**
`/api/v1/identities/*` não está acessível de fora do processo backend
nesta fatia — não existe autenticação implementada ainda, e expor a API
sem autenticação seria uma falha de segurança, não uma decisão neutra.
Essa restrição é, ela mesma, parte do controle de segurança desta
entrega (ver seção "Segurança" abaixo).

### Segurança — pontos auditados nesta entrega

- **IDOR/enumeração:** `publicId` é um UUIDv4 aleatório (`PublicId.generate()`),
  não sequencial — não há como enumerar identities por incremento. A
  resposta de "não encontrado" (404) e de "formato inválido" (422) usam
  códigos e tempos de resposta que não dependem de dado sensível (a
  consulta ao banco é feita da mesma forma em ambos os casos de leitura
  malsucedida; a única distinção de timing é a checagem local de formato
  do UUID acontecer antes de qualquer consulta — que é responder MAIS
  RÁPIDO para input malformado, não mais devagar, então não cria um
  oráculo de timing para diferenciar "existe mas..." de "não existe").
- **Exposição de e-mail:** o e-mail de exibição é retornado (é o
  conceito documentado no contrato), mas nunca o normalizado; nenhum CPF
  é exposto nesta primeira versão.
- **Logs:** nenhum log desta fatia imprime o corpo da resposta, o e-mail
  ou qualquer dado pessoal — só o log de bootstrap do servidor (host,
  porta, `NODE_ENV`) já existente desde a v0.4.1.
- **`internalId`:** nunca sai da camada de infraestrutura — reforçado
  por teste automatizado (`IdentityHttpMapper.test.ts`).
- **SQL injection:** `findByPublicId` (reutilizado sem alteração) já
  usava query parametrizada; nenhuma query nova foi criada nesta fatia.
- **Erro sanitizado:** o handler de erro central nunca inclui SQL, stack
  trace, nome de tabela/coluna ou mensagem de driver `mysql2` na
  resposta — testado ponta a ponta.

### Catálogo de erros — IDENTITY_PUBLIC_ID_INVALID formalizado

`IDENTITY_PUBLIC_ID_INVALID` (código já existente desde a v0.4.0, em
`PublicId.ts`) foi formalmente adicionado à tabela de
`docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md` nesta revisão (Validação,
HTTP conceitual 422 — mesmo padrão já documentado para todo outro erro
"Validação" de formato: `IDENTITY_EMAIL_INVALID`, `IDENTITY_NAME_INVALID`,
etc.). Durante essa formalização, uma inconsistência real foi corrigida:
a mensagem de `InvalidPublicIdError` incluía o valor bruto inválido
recebido (ex.: `Public ID inválido: "xyz" não é...`) — isso violava a
regra "não incluir o valor bruto inválido na mensagem externa" agora
explícita no catálogo, já que essa mensagem vai direto para a resposta
HTTP via `mapDomainErrorToHttp`. Corrigido: a mensagem não recebe mais o
valor de entrada.

### Versionamento — pendência técnica

`package.json` e o payload de `/health` estavam ambos travados em
`"0.4.1"` mesmo depois das entregas de v0.4.2 completas — bumpados nesta
entrega para `"0.5.0"`.

**Pendência técnica:** Consolidar package.json como fonte única de
versão do runtime.

### Flake de testes conhecido (pré-existente, não desta fatia)

`build.test.ts` e `main.test.ts` manipulam `dist/` concorrentemente
quando o vitest executa arquivos de teste em workers paralelos — cada um
faz seu próprio `rm -rf dist`/rebuild ou depende de `dist/main.js`
existir. Isso pode gerar uma falha intermitente e rara (observada uma
vez em várias dezenas de execuções desta fatia; as 3 execuções
consecutivas exigidas antes desta entrega terminaram limpas). Não é uma
falha determinística nem uma regressão de código — é uma característica
da arquitetura atual de testes (dois arquivos que tocam o mesmo
diretório de build sem coordenação entre si). Deliberadamente **não
corrigido nesta fatia** (fora de escopo: não serializar a suíte, não
desabilitar/remover nenhum dos dois arquivos, não aumentar timeout como
paliativo) — registrado aqui como pendência técnica para uma fatia de
manutenção de testes futura.

## Correção: entrypoint real separado de `server.ts` (v0.4.2)


**Bug real corrigido, observado em DEV sob PM2:** o processo aparecia
`online` no PM2, com PID estável, mas nunca abria socket em `3011` —
`/health` nunca respondia, sem nenhum erro nos logs. Causa: `server.ts`
decidia sozinho, comparando `process.argv[1]` com `import.meta.url`, se
"era o entrypoint" para então chamar `startServer()` automaticamente.
Essa heurística funciona com `node dist/server.js` executado diretamente,
mas não é confiável sob o carregamento de módulo do PM2 — o módulo era
carregado, mas `startServer()` nunca era invocada.

**Correção:** `server.ts` agora é só um módulo reutilizável/import-safe
— nunca inicia nada sozinho ao ser importado, nem tenta detectar "sou o
principal?" de forma alguma. `src/main.ts` é o novo entrypoint executável
mínimo: importa `startServer` e a chama explicitamente. **O runtime
executado por PM2/`npm start` agora é `dist/main.js`, nunca mais
`dist/server.js`.**

## Escopo desta fatia (v0.4.2 — preparação)

**Esta fatia PREPARA a integração real com MariaDB — não a executa.**
Nenhuma migration foi aplicada contra `pctec_ingressa_dev` ou qualquer
outro banco real como parte desta entrega.

Implementado:

- `MigrationRunner` estendido: checksum SHA-256 por migration aplicada,
  detecção de migration já aplicada com conteúdo alterado
  (`MigrationChecksumMismatchError`), `status()` (leitura pura),
  `rollbackLast()`/`rollbackAll()`, lock nomeado (`GET_LOCK`/
  `RELEASE_LOCK`) contra dois runners concorrentes.
- Migration corretiva `0004_add_checksum_and_timing_to_schema_migrations`
  — aditiva, não altera as 3 migrations já promovidas em `dev`.
- CLI operacional (`src/cli/migrate.ts`): `status`/`up`/`down`/`down-all`,
  com `--dry-run` e exigência de `--yes` explícito para ações
  destrutivas.
- Scripts npm: `migrate:status`, `migrate:up`, `migrate:up:dry-run`,
  `migrate:down`, `migrate:down-all`.
- Runbook completo para a execução real em DEV:
  [`docs/07-operacao/MIGRATIONS-DEV-RUNBOOK.md`](../docs/07-operacao/MIGRATIONS-DEV-RUNBOOK.md)
  (fases A–G, recomendação de usuários/privilégios, comandos SQL seguros
  — nada disso foi executado ainda).

**Não implementado/não executado nesta fatia:**

criação de `pctec_ingressa_dev` real, aplicação de qualquer migration
contra um MariaDB real, qualquer conexão ao servidor DEV, health check
de dependência de banco (mudança de contrato de `/health`, fora de
escopo aqui).

## v0.4.1 — Runtime Bootstrap (fatia anterior)

Implementado:

- Runtime HTTP mínimo: `Express`, `src/app/http/createApp.ts` (fábrica da
  app) separado de `src/server.ts` (entrypoint, bind e encerramento
  gracioso).
- `GET /health` — único endpoint público. Não consulta banco, não
  depende de migration, payload fixo e determinístico.
- Encerramento gracioso em `SIGTERM`/`SIGINT`.
- `HOST`/`PORT` validados via Zod (`src/app/config/env.ts`), default
  `127.0.0.1:3011`.
- `ecosystem.config.cjs` preparado para uso futuro do PM2 — **não
  iniciado**.

## v0.4.0 — Identity Core, Vertical Slice 1 (fatia anterior)

Implementado:

- Fundação backend em TypeScript (Node.js 22).
- Aggregate Root `Identity` (bounded context `identity`), com todos os
  comandos de ciclo de vida exceto `AnonymizeIdentity` (ver limites
  abaixo).
- Value Objects: `PublicId`, `IdentityType`, `IdentityStatus`,
  `IdentityName`, `Email`, `Cpf`, `ActorPublicId`, `DeletionReason`.
- Persistência MariaDB via `mysql2/promise`, com optimistic locking por
  `version`.
- Tabela de auditoria (`AuditEvent`), imutável, gravada na mesma
  transação da criação de `Identity`.
- Migrations reversíveis (`.up.sql`/`.down.sql`) para
  `schema_migrations`, `identities` e `audit_events`.
- Testes unitários e de persistência preparados, sem depender de banco
  externo.

## Requisitos

- Node.js **22** ou superior.
- npm.
- MariaDB **10.11** (necessário para testes de integração opcionais e
  para a validação de migrations — nunca para rodar a suíte padrão ou
  `GET /health`).

## Instalação

```bash
cd backend
npm install
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o servidor em modo desenvolvimento (`tsx watch`), recarregando ao salvar. |
| `npm run build` | Compila TypeScript para `dist/` **e** copia os assets de migration (`*.up.sql`/`*.down.sql`) para `dist/shared/database/migrations/` — ver nota abaixo. |
| `npm start` | Roda o build compilado (`node dist/main.js`) — o que o PM2 executa em produção. `dist/server.js` é só um módulo (nunca executado diretamente). |
| `npm test` | Roda a suíte de testes unitários. **Nunca** depende de banco externo. |
| `npm run test:integration` | Roda testes de integração. Requer `RUN_INTEGRATION_TESTS=true` e um MariaDB real acessível via as variáveis `DB_*`. |
| `npm run typecheck` | Verifica tipos com TypeScript, sem gerar saída. |
| `npm run bootstrap:first-identity` | CLI interativo, one-shot — cria a primeira Identity fundacional da plataforma (ver seção acima). |

### Migrations SQL são assets obrigatórios do build

`tsc` compila apenas arquivos `.ts` — ele **não copia** arquivos não-TS
para `dist/`. Como as migrations vivem em `src/shared/database/migrations/*.sql`
(fonte única de verdade, revisável por um DBA sem ler TypeScript),
`npm run build` executa um segundo passo depois do `tsc`:
[`scripts/copy-migration-assets.mjs`](./scripts/copy-migration-assets.mjs)
copia `*.up.sql`/`*.down.sql` para `dist/shared/database/migrations/`,
byte-a-byte, falhando explicitamente se o diretório fonte não existir, se
não houver nenhuma migration, ou se algum par `up`/`down` estiver
incompleto.

Sem esse passo, `node dist/cli/migrate.js` (ou qualquer código compilado
que dependa de `loadMigrationDefinitions`) falha com
`ENOENT: no such file or directory, scandir '.../dist/shared/database/migrations'`
— foi exatamente esse defeito de empacotamento, encontrado em DEV antes
da primeira migration real, que motivou este passo adicional no build
(nenhuma migration chegou a ser executada quando isso ocorreu).

`loadMigrationDefinitions()` nunca tem fallback para `src/` em tempo de
execução — o runtime compilado depende exclusivamente de
`dist/shared/database/migrations/`.

## Variáveis de ambiente

Copie `.env.example` para `.env` e ajuste conforme seu ambiente local:

```bash
cp .env.example .env
```

| Variável | Descrição |
|---|---|
| `DB_HOST` | Host do MariaDB (usado por testes de integração e validação de migrations). |
| `DB_PORT` | Porta do MariaDB. |
| `DB_NAME` | Nome do banco (`pctec_ingressa` em dev geral; `pctec_ingressa_dev` é o banco isolado desta fatia — ver seção de migrations). |
| `DB_USER` | Usuário de aplicação. |
| `DB_PASSWORD` | Senha — **nunca preencha com um segredo real no `.env.example`**; o `.env` real (com valores de verdade) não deve ser versionado. |
| `RUN_INTEGRATION_TESTS` | `true`/`false`. Controla se os testes de integração (Identity/Audit) executam de fato. |
| `HOST` | Interface de bind do servidor HTTP. Default `127.0.0.1`. |
| `PORT` | Porta do servidor HTTP. Default `3011`. |
| `NODE_ENV` | `development`/`test`/`production`. |

Nenhuma dessas variáveis é lida automaticamente ao importar módulos desta
fatia — a validação (`src/app/config/env.ts`) só roda quando
explicitamente chamada (por `startServer()`, invocada pelo entrypoint
`src/main.ts`, ou por testes que a exercitam diretamente).

## Como rodar os testes unitários

```bash
npm test
```

Não requer `.env`, não requer MariaDB, não abre nenhuma conexão de rede
externa (os testes de `GET /health` sobem um servidor HTTP efêmero local,
em porta escolhida pelo SO — nunca a porta fixa 3011). Usa fakes em
memória (`FakeQueryable`, repositórios in-memory) para exercitar toda a
lógica de domínio, aplicação e mapeamento SQL sem depender de
infraestrutura externa.

## Como rodar o servidor manualmente (sem PM2)

```bash
npm run build
npm start
# em outro terminal:
curl -i http://127.0.0.1:3011/health
```

Encerre com `Ctrl+C` (`SIGINT`) ou `kill -TERM <pid>` — o processo fecha
a porta graciosamente antes de sair.

## PM2 (preparado, não iniciado)

`ecosystem.config.cjs` está pronto (`name: ingressa-backend`, `script:
dist/main.js`, `fork`, `instances: 1`, `HOST=127.0.0.1`, `PORT=3011`).
Extensão `.cjs` (não `.js`) é deliberada: o `package.json` tem
`"type": "module"`, e um `ecosystem.config.js` seria carregado como ESM
por padrão, quebrando o `module.exports` que o PM2 espera.

**Nenhum `pm2 start`/`restart`/`save` foi executado nesta fatia.**

## Como habilitar os testes de integração (Identity/Audit)

1. Suba um MariaDB 10.11 **local ou descartável** (nunca aponte para o
   ambiente DEV compartilhado a partir de testes automatizados).
2. Preencha `.env` com as credenciais desse MariaDB.
3. Defina `RUN_INTEGRATION_TESTS=true`.
4. Rode `npm run test:integration`.

O teste de integração disponível
(`src/modules/identity/tests/MariaDbIdentityRepository.integration.test.ts`)
aplica as migrations contra o banco de destino antes de testar, e as
reverte ao final (best-effort).

## Migrations — CLI operacional (v0.4.2)

```bash
npm run build   # o CLI roda a partir de dist/, igual ao server

npm run migrate:status        # leitura pura — nunca escreve
npm run migrate:up            # aplica pendentes
npm run migrate:up:dry-run    # mostra o que seria aplicado, sem aplicar
npm run migrate:down          # reverte só a última aplicada — preview apenas
npm run migrate:down-all      # reverte todas, ordem reversa — preview apenas
```

`down`/`down-all` só executam de verdade com **duas condições
simultâneas**: o argumento `--yes` **e** a variável de ambiente
`MIGRATIONS_ALLOW_DESTRUCTIVE=true`. Sem qualquer uma das duas, mostra o
preview e sai com código `1`, sem alterar nada:
```bash
MIGRATIONS_ALLOW_DESTRUCTIVE=true npm run migrate:down -- --yes
MIGRATIONS_ALLOW_DESTRUCTIVE=true npm run migrate:down-all -- --yes
```

**`NODE_ENV=production` recusa sempre**, mesmo com as duas condições
acima presentes — sai com código `2`. Não há bypass para este caso.

Cada migration aplicada tem seu checksum SHA-256 registrado. Se o
conteúdo de uma migration já aplicada mudar (arquivo `.up.sql` editado
depois do fato), `migrate:status`/`migrate:up` detectam a divergência e
falham explicitamente (`MigrationChecksumMismatchError`) em vez de
aplicar silenciosamente. Linhas aplicadas antes de a coluna `checksum`
existir (migration `0004`) aparecem como `checksum_unknown` — não é uma
incompatibilidade, é a ausência histórica do dado.

Um lock nomeado (`GET_LOCK`/`RELEASE_LOCK` do MariaDB), adquirido sobre
a **mesma conexão física** usada para aplicar/reverter e ler/escrever
`schema_migrations`, impede que dois `migrate:up`/`migrate:down` rodem
concorrentemente contra o mesmo banco. Se uma migration falhar no meio
da execução, o runner interrompe imediatamente (nenhuma migration
seguinte roda), nunca registra a migration como aplicada, libera o lock,
e nunca promete reverter automaticamente o que já tiver sido alterado
(DDL não é transacional no MariaDB/InnoDB) — ver
[`docs/07-operacao/MIGRATIONS-DEV-RUNBOOK.md`](../docs/07-operacao/MIGRATIONS-DEV-RUNBOOK.md)
para o procedimento de diagnóstico manual.

Cada arquivo `.up.sql`/`.down.sql` precisa ter exatamente uma instrução
SQL executável — validado antes de qualquer conexão ser aberta
(`MigrationMultipleStatementsError` se violado). `multipleStatements`
nunca é habilitado na conexão.

**Nenhum destes comandos conecta a `pctec_ingressa_dev` por padrão** — o
alvo vem de `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` no
ambiente de quem executa (ver `.env.example`). O runbook completo para a
execução real em DEV está em
[`docs/07-operacao/MIGRATIONS-DEV-RUNBOOK.md`](../docs/07-operacao/MIGRATIONS-DEV-RUNBOOK.md).

## Validação de migrations contra `pctec_ingressa_dev`

**⚠️ Nenhuma migration foi executada contra `pctec_ingressa_dev` como
parte de nenhuma fatia até agora (v0.4.0, v0.4.1, v0.4.2).** A v0.4.2
preparou o CLI, o runbook e a extensão do runner — a execução real
depende de acesso ao servidor DEV (fora do ambiente em que esta entrega
foi construída) e de autorização explícita antes de qualquer
`CREATE DATABASE`/migration real.

## Limites desta fatia (v0.4.2)

- Nenhuma migration foi executada contra `pctec_ingressa_dev` nem
  qualquer outro banco real.
- `pctec_ingressa_dev` **não foi criado**.
- Nenhum usuário de banco (`pctec_ingressa_dev_migrator`/`pctec_ingressa_dev_app`)
  foi criado de fato — nomenclatura e privilégios já aprovados pelo
  Product Owner/Platform Architect (ver runbook), execução real
  pendente do acesso ao servidor DEV.
- Gate duplo de rollback (`--yes` + `MIGRATIONS_ALLOW_DESTRUCTIVE=true`)
  e recusa incondicional em `NODE_ENV=production` implementados e
  testados — nunca exercitados contra um banco real ainda.
- `GET /health` continua sem checar banco — deliberado, não alterado
  nesta fatia (ver runbook, Fase G).
- DDL não é transacional no MariaDB/InnoDB — limitação do motor,
  documentada em `MigrationRunner.ts`, não resolvida por este runner (não
  há como resolver de fato; CREATE/ALTER/DROP TABLE sempre dão commit
  implícito).
- Backfill de checksum só cobre migrations aplicadas na MESMA chamada de
  `applyPending` que também aplica a migration que cria a coluna
  (`0004`) — migrations aplicadas numa execução passada, antes de `0004`
  existir, permanecem `checksum_unknown` para sempre (nunca preenchidas
  retroativamente a partir do conteúdo atual do arquivo, por segurança:
  não temos como confirmar que o conteúdo aplicado então era o mesmo de
  agora).
- PM2 não foi iniciado. Nginx não foi alterado.

## Limites da v0.4.1 (fatia anterior)

- `GET /health` é o único endpoint público. Nenhuma outra rota HTTP
  existe.
- `AnonymizeIdentity` não foi implementado — a estratégia concreta de
  anonimização (algoritmo/forma dos valores não reversíveis) é uma
  decisão arquitetural ainda pendente nos documentos de domínio
  (`IDENTITY-DOMAIN-DESIGN.md`, seção 17); implementá-la agora exigiria
  inventar essa decisão em código, o que este backend evita
  deliberadamente.
- `RequestEmailChange`/`ConfirmEmailChange` não persistem um estado
  "e-mail pendente" — `ConfirmEmailChange` recebe o novo e-mail
  diretamente como parâmetro. Isso é consistente com
  `MODELO-RELACIONAL-PROPOSTO.md` (a tabela `identities` não tem coluna
  para e-mail pendente) e com a nota do documento de domínio de que o
  mecanismo de confirmação pertence ao bounded context `security`.
- Erros de autenticação (`IDENTITY_LOGIN_DISABLED`, `IDENTITY_BLOCKED`,
  `IDENTITY_INACTIVE`) não são lançados por nenhum código nesta fatia —
  não há comando de autenticação implementado ainda.
- Cobertura de testes (`--coverage`) não está configurada — exigiria
  adicionar `@vitest/coverage-v8` como nova dependência de
  desenvolvimento, o que não pareceu justificado só para esta métrica
  nesta fatia.
- `MigrationRunner` (`src/shared/database/MigrationRunner.ts`) só expõe
  `applyPending` — não há orquestração automática de rollback em código;
  o SQL `.down.sql` de cada migration existe para reversão manual
  documentada. A validação de rollback desta fatia (seção de migrations
  acima) é feita aplicando esses arquivos `.down.sql` diretamente, sem
  alterar `MigrationRunner`.

## Estrutura

```
backend/
├── src/
│   ├── app/
│   │   ├── config/           — validação de variáveis de ambiente (Zod)
│   │   └── http/              — createApp() (Express, GET /health, GET /api/v1/identities/:publicId)
│   ├── main.ts                 — entrypoint executável real (o que PM2/npm start rodam)
│   ├── server.ts               — módulo reutilizável/import-safe: startServer(), shutdown gracioso — NUNCA inicia nada sozinho
│   ├── cli/
│   │   ├── migrate.ts         — CLI de migrations (status/up/down/down-all)
│   │   └── bootstrap-first-identity.ts — CLI one-shot de bootstrap (v0.5.0 Slice 2)
│   ├── shared/
│   │   ├── database/          — Pool, UnitOfWork, MigrationRunner, migrations/
│   │   ├── errors/            — DomainError (base)
│   │   ├── http/              — correlationId, mapDomainErrorToHttp (DomainError → status HTTP)
│   │   └── types/              — DomainEvent (base), integration-test-guard
│   ├── tests/                 — testes que não pertencem a um módulo específico (server, build, main)
│   └── modules/
│       ├── identity/
│       │   ├── domain/        — Identity (Aggregate Root), Value Objects, eventos, erros
│       │   ├── application/   — CreateIdentityService, GetIdentityByPublicIdService, BootstrapFirstIdentityService
│       │   ├── infrastructure/persistence/ — MariaDbIdentityRepository
│       │   ├── http/          — identityRoutes (controller), IdentityHttpMapper (presenter)
│       │   └── tests/
│       └── audit/
│           ├── domain/        — AuditEvent, AuditEventRepository (contrato)
│           ├── infrastructure/ — MariaDbAuditEventRepository
│           └── tests/
├── ecosystem.config.cjs       — configuração PM2 (não iniciada)

docs/07-operacao/
└── MIGRATIONS-DEV-RUNBOOK.md  — runbook completo para execução real em DEV (v0.4.2)
```
