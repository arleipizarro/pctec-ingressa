# PCTEC Ingressa — Backend

Backend do PCTEC Ingressa. Este README cobre o estado cumulativo até a
**v0.4.1 — Runtime Bootstrap & Migration Validation**, que evolui a
**v0.4.0 — Identity Core, Vertical Slice 1** anterior.

## Escopo desta fatia (v0.4.1)

Implementado nesta fatia, além de tudo já descrito na v0.4.0 abaixo:

- Runtime HTTP mínimo: `Express` reintroduzido como dependência real
  (`^5.2.1`, sem vulnerabilidade de produção conhecida — ver `npm audit
  --omit=dev` mais abaixo), com `src/app/http/createApp.ts` (fábrica da
  app, sem abrir porta) separado de `src/server.ts` (entrypoint, abre
  porta e trata sinais de encerramento).
- `GET /health` — único endpoint público desta fatia. Não consulta banco,
  não depende de migration, payload fixo e determinístico.
- Encerramento gracioso em `SIGTERM`/`SIGINT`.
- `HOST`/`PORT` adicionados à validação de ambiente (`src/app/config/env.ts`),
  com `HOST` default `127.0.0.1` (nunca `0.0.0.0` por omissão — não há
  Nginx na frente ainda) e `PORT` default `3011`.
- `ecosystem.config.cjs` preparado para uso futuro do PM2 — **não
  iniciado nesta fatia**.
- Scripts `dev`/`build`/`start` no `package.json`.

**Não implementado nesta fatia** (fora de escopo, ver prompt de
implementação da v0.4.1):

login, Identity API, JWT, sessão, credenciais, frontend, Nginx,
integração com Portal, qualquer rota além de `/health`, execução real do
PM2 (`pm2 start`), execução real de migrations contra `pctec_ingressa_dev`
sem autorização explícita (ver seção de migrations abaixo).

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

## Validação de migrations contra `pctec_ingressa_dev` (v0.4.1)

**⚠️ Nenhuma migration foi executada contra `pctec_ingressa_dev` como
parte desta entrega.** O procedimento (criar banco isolado → aplicar →
validar schema → reaplicar para provar idempotência → rollback em ordem
reversa → confirmar remoção → reaplicar → deixar aplicado e vazio) está
documentado e aguardando autorização explícita antes de qualquer `CREATE
DATABASE`/`DROP DATABASE` real — ver relatório desta entrega para o
plano exato.

## Limites desta fatia

- `GET /health` é o único endpoint público. Nenhuma outra rota HTTP
  existe.
- Nenhuma migration foi executada contra `pctec_ingressa_dev` nem
  qualquer outro banco real nesta fatia.
- PM2 não foi iniciado.
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
```
