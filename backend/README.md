# PCTEC Ingressa — Backend

Backend do PCTEC Ingressa. Este README cobre exclusivamente o estado da
**v0.4.0 — Identity Core, Vertical Slice 1**.

## Escopo desta fatia

Implementado:

- Fundação backend em TypeScript (Node.js 22, Express **não incluído** —
  ver "Decisões desta fatia" abaixo).
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
  `schema_migrations`, `identities` e `audit_events` — **não
  executadas**.
- Testes unitários e de persistência preparados, sem depender de banco
  externo.

**Não implementado nesta fatia** (deliberadamente fora de escopo — ver
prompt de implementação da v0.4.0 Slice 1):

login, senha, `Credential`, `MagicLink`, `Session`, `RefreshToken`, JWT,
OAuth/OIDC, MFA, frontend, Nginx, PM2, envio de e-mail, organizações,
memberships, aplicações, integração com Portal ou qualquer outro produto,
deploy, `AnonymizeIdentity` (estratégia de anonimização ainda é "Pendente
de decisão" nos documentos de domínio), rotas HTTP/controllers.

## Requisitos

- Node.js **22** ou superior.
- npm.
- MariaDB **10.11** (apenas necessário para testes de integração
  opcionais — não é necessário para rodar a suíte padrão).

## Instalação

```bash
cd backend
npm install
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm test` | Roda a suíte de testes unitários. **Nunca** depende de banco externo. |
| `npm run test:integration` | Roda testes de integração. Requer `RUN_INTEGRATION_TESTS=true` e um MariaDB real acessível via as variáveis `DB_*`. |
| `npm run typecheck` | Verifica tipos com TypeScript, sem gerar saída. |
| `npm run build` | Compila TypeScript para `dist/`. |

## Variáveis de ambiente

Copie `.env.example` para `.env` e ajuste conforme seu ambiente local:

```bash
cp .env.example .env
```

| Variável | Descrição |
|---|---|
| `DB_HOST` | Host do MariaDB (usado apenas por testes de integração nesta fatia). |
| `DB_PORT` | Porta do MariaDB. |
| `DB_NAME` | Nome do banco (`pctec_ingressa`). |
| `DB_USER` | Usuário de aplicação. |
| `DB_PASSWORD` | Senha — **nunca preencha com um segredo real no `.env.example`**; o `.env` real (com valores de verdade) não deve ser versionado. |
| `RUN_INTEGRATION_TESTS` | `true`/`false`. Controla se os testes de integração executam de fato. |
| `NODE_ENV` | `development`/`test`/`production`. |

Nenhuma dessas variáveis é lida automaticamente ao importar módulos desta
fatia — a validação (`src/app/config/env.ts`) só roda quando
explicitamente chamada (hoje, apenas pelo teste de integração opcional).

## Como rodar os testes unitários

```bash
npm test
```

Não requer `.env`, não requer MariaDB, não abre nenhuma conexão de rede.
Usa fakes em memória (`FakeQueryable`, repositórios in-memory) para
exercitar toda a lógica de domínio, aplicação e mapeamento SQL sem
depender de infraestrutura externa.

## Como habilitar os testes de integração (futuramente)

1. Suba um MariaDB 10.11 **local ou descartável** (nunca aponte para o
   ambiente DEV compartilhado a partir de testes automatizados).
2. Preencha `.env` com as credenciais desse MariaDB.
3. Defina `RUN_INTEGRATION_TESTS=true`.
4. Rode `npm run test:integration`.

O teste de integração disponível
(`src/modules/identity/tests/MariaDbIdentityRepository.integration.test.ts`)
aplica as migrations contra o banco de destino antes de testar, e as
reverte ao final (best-effort).

**⚠️ Aviso explícito: nenhuma migration foi executada como parte desta
entrega.** Os arquivos em `src/shared/database/migrations/*.sql` são
material de revisão arquitetural — a aplicação real das migrations
(mesmo em ambiente de desenvolvimento) depende de aprovação explícita do
Product Owner/Platform Architect em uma fatia futura.

## Limites desta fatia

- Nenhuma rota HTTP ou controller existe. Não há servidor iniciado em
  nenhum ponto de entrada.
- `Express` **não é uma dependência instalada** nesta fatia — está
  aprovado na stack do projeto, mas só será adicionado quando a primeira
  rota HTTP for de fato implementada, para não carregar uma dependência
  não utilizada (e a superfície de vulnerabilidades associada a ela) sem
  necessidade real.
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

## Estrutura

```
backend/
├── src/
│   ├── app/config/          — validação de variáveis de ambiente (Zod)
│   ├── shared/
│   │   ├── database/        — Pool, UnitOfWork, MigrationRunner, migrations/
│   │   ├── errors/          — DomainError (base)
│   │   └── types/           — DomainEvent (base), integration-test-guard
│   └── modules/
│       ├── identity/
│       │   ├── domain/      — Identity (Aggregate Root), Value Objects, eventos, erros
│       │   ├── application/ — CreateIdentityService
│       │   ├── infrastructure/persistence/ — MariaDbIdentityRepository
│       │   └── tests/
│       └── audit/
│           ├── domain/      — AuditEvent, AuditEventRepository (contrato)
│           ├── infrastructure/ — MariaDbAuditEventRepository
│           └── tests/
```
