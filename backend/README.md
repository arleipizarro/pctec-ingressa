# PCTEC Ingressa — Backend

Backend do PCTEC Ingressa. Este README cobre o estado cumulativo até a
**v0.4.2 — MariaDB Integration (preparação)**, que evolui a
**v0.4.1 — Runtime Bootstrap** e a **v0.4.0 — Identity Core, Vertical
Slice 1** anteriores.

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
| `npm run build` | Compila TypeScript para `dist/`. |
| `npm start` | Roda o build compilado (`node dist/server.js`) — o que o PM2 executa em produção. |
| `npm test` | Roda a suíte de testes unitários. **Nunca** depende de banco externo. |
| `npm run test:integration` | Roda testes de integração. Requer `RUN_INTEGRATION_TESTS=true` e um MariaDB real acessível via as variáveis `DB_*`. |
| `npm run typecheck` | Verifica tipos com TypeScript, sem gerar saída. |

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
explicitamente chamada (pelo entrypoint `server.ts`, ou por testes que a
exercitam diretamente).

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
dist/server.js`, `fork`, `instances: 1`, `HOST=127.0.0.1`, `PORT=3011`).
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
│   │   └── http/              — createApp() (Express, GET /health)
│   ├── server.ts              — entrypoint (bind HOST:PORT, shutdown gracioso)
│   ├── cli/
│   │   └── migrate.ts         — CLI de migrations (status/up/down/down-all)
│   ├── shared/
│   │   ├── database/          — Pool, UnitOfWork, MigrationRunner, migrations/
│   │   ├── errors/            — DomainError (base)
│   │   └── types/              — DomainEvent (base), integration-test-guard
│   ├── tests/                 — testes que não pertencem a um módulo específico (server, build)
│   └── modules/
│       ├── identity/
│       │   ├── domain/        — Identity (Aggregate Root), Value Objects, eventos, erros
│       │   ├── application/   — CreateIdentityService
│       │   ├── infrastructure/persistence/ — MariaDbIdentityRepository
│       │   └── tests/
│       └── audit/
│           ├── domain/        — AuditEvent, AuditEventRepository (contrato)
│           ├── infrastructure/ — MariaDbAuditEventRepository
│           └── tests/
├── ecosystem.config.cjs       — configuração PM2 (não iniciada)

docs/07-operacao/
└── MIGRATIONS-DEV-RUNBOOK.md  — runbook completo para execução real em DEV (v0.4.2)
```
