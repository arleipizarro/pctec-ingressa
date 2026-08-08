# Admin Bootstrap Design — PCTEC Ingressa (v0.5.0, Vertical Slice 2)

Versão associada: v0.5.0 — Identity API, Vertical Slice 2 (documental +
implementação)
Status: Implementado em código nesta rodada (terceira revisão) — ver
`docs/adr/ADR-027-BOOTSTRAP-ADMINISTRATIVO-INICIAL.md` para a decisão
completa e sua justificativa; este documento detalha o "como".

**Implementado nesta entrega:** `BootstrapFirstIdentityService`,
`Identity.createFoundational()`, `IdentityRepository.countAll()`, os
erros `BootstrapAlreadyCompletedError`/`BootstrapLockNotAcquiredError`
(e sua formalização em `IDENTITY-DOMAIN-ERRORS.md`), e o CLI
`npm run bootstrap:first-identity` (`src/cli/bootstrap-first-identity.ts`).
**Executado com sucesso no MariaDB DEV real** — o CLI foi rodado e
validado diretamente no banco; ver ADR-027, seção "Execução real da Fase
A", para os dados operacionais registrados (nunca hardcoded em código). Tudo
adicionalmente validado por testes automatizados (fakes) e um teste de
integração preparado, ainda não executado.

**Nomenclatura:** este documento chama o resultado do CLI de
**"Identity fundacional"**, nunca "administrador" — ver ADR-027, seção
"Fases", para a separação explícita entre bootstrap (Fase A, concluída) e
autoridade administrativa real (Fase B, implementada em código mas ainda
não executada; Fases C/D, fora de escopo).

---

## 1. CLI `bootstrap:first-identity` — implementado

### 1.1 Fluxo

```
npm run bootstrap:admin
  ↓
src/cli/bootstrapAdmin.ts (entrypoint mínimo, mesmo padrão de src/main.ts)
  ↓
1. Carrega env (loadEnv) — credenciais runtime (pctec_ingressa_dev_app em
   DEV), NUNCA credenciais de migration.
2. Bloqueia se NODE_ENV=production (ver 1.3).
3. Obtém UMA conexão do pool (não o pool inteiro) — a mesma conexão é
   usada para o lock, a leitura de contagem e a escrita, do início ao
   fim (mesma lição já aplicada em MigrationRunner).
4. GET_LOCK('pctec_ingressa_identity_bootstrap', timeout) nessa conexão.
   - Não obtido → encerra: "outro processo de bootstrap em execução"
     (exit code distinto de "já concluído no passado").
5. Dentro de uma transação, na mesma conexão:
   SELECT COUNT(*) FROM identities.
   - > 0 → BOOTSTRAP_ALREADY_COMPLETED, rollback, RELEASE_LOCK, encerra
     sem coletar nenhum dado do operador.
6. Coleta interativa: fullName, email, cpf (opcional).
7. Confirmação explícita (não silenciosa) antes de prosseguir.
8. BootstrapFirstIdentityService (novo — ver seção 1.2) cria a Identity
   fundacional na mesma transação: created_by_identity_public_id = NULL;
   evento/auditoria com actor_public_id = "BOOTSTRAP".
9. Insere o AuditEvent correspondente na mesma transação.
10. COMMIT.
11. RELEASE_LOCK no finally (mesma conexão), sempre.
12. Reporta sucesso: publicId gerado, status inicial (PENDING). Nunca
    ecoa CPF completo. Deixa claro na saída que isto é a Identity
    fundacional, não um administrador funcional (ver seção 3).
13. Devolve a conexão, encerra. Exit code 0.
```

### 1.2 Reuso vs. código novo (implementado)

| Peça | Reuso ou novo |
|---|---|
| `Identity` (Aggregate Root), Value Objects | Reuso da maior parte; **`Identity.createFoundational()`** implementado como método estático novo e isolado — `Identity.create()` e todos os comandos de mutação permanecem intocados. |
| `CreateIdentityService` | **Não reaproveitado.** Sua assinatura (`actorPublicId: string`) alimenta, com o mesmo valor, tanto `created_by_identity_public_id` quanto o `actor_public_id` do evento — os dois precisam divergir no bootstrap (`NULL` vs. `"BOOTSTRAP"`), confirmado por auditoria de código que `CreateIdentityService` não suporta isso. |
| `BootstrapFirstIdentityService` | **Implementado** — Application Service dedicado, orquestrando `Identity`/`IdentityRepository`/`AuditEventRepository` sobre uma conexão/transação gerenciada diretamente (não via `UnitOfWork` — ver 1.3). |
| `UnitOfWork`/`MariaDbUnitOfWork` | **Não usado** por este serviço — `runInTransaction` faz commit só depois do callback retornar, o que forçaria `RELEASE_LOCK` a rodar antes do `COMMIT` (corrida real). |
| `IdentityRepository`/`MariaDbIdentityRepository` | Reuso do contrato de `insert()` (nenhuma alteração necessária — já trata `createdBy` `undefined` corretamente); **`countAll()` implementado** como guard. |
| `AuditEventRepository` | Reuso integral, sem alteração. |
| `ActorPublicId` | **Não estendido** — a divergência é tratada inteiramente dentro de `Identity.createFoundational()`, não como um terceiro valor genérico de `ActorPublicId` usado em todo o domínio (Opção A da ADR-027 permanece rejeitada). |
| CLI (`bootstrap-first-identity.ts`) | **Implementado** — mesmo padrão de `src/cli/migrate.ts` (lógica pura `runBootstrapCli` separada de I/O real). |

### 1.3 Controles de segurança

- **Execução somente local:** nunca abre socket (verificável por
  auditoria estrutural do código-fonte, mesmo padrão já usado para
  `identityRoutes.integration.test.ts`).
- **Confirmação:** `--yes` (mesmo padrão de `migrate.ts`) **e**
  confirmação textual interativa por padrão.
- **Proteção contra repetição:** named lock + `COUNT(identities) = 0` —
  ver ADR-027, seção "One-shot guard", para a justificativa completa de
  por que isso é mais forte que depender de um marcador de `created_by`.
- **Nunca imprimir CPF completo:** mascarado se ecoado na confirmação.
- **Nunca imprimir segredo:** não há segredo nesta etapa (sem
  `Credential`).
- **Não logar env inteiro:** só host/porta/usuário/banco, nunca senha
  (mesmo padrão de `migrate.ts`).
- **Usuário runtime do banco:** `DB_USER` de `loadEnv()`.
- **Bloquear `NODE_ENV=production`** nesta fase.
- **Não depender de Nginx/PM2.**
- **Não abrir socket.**
- **Exit codes previsíveis:** `0` sucesso; `1` `BOOTSTRAP_ALREADY_COMPLETED`
  ou erro de validação; `2` recusa por `NODE_ENV=production`; `3`
  (proposto) lock não obtido — concorrência em andamento, distinto de
  "já concluído".
- **Cleanup correto em erro:** conexão sempre devolvida ao pool no
  `finally`; lock sempre liberado no `finally`; nunca mascara o erro
  original (mesmo padrão de `cleanupIntegrationTest`).

### 1.4 Testes previstos (próxima entrega)

Lógica de decisão separada de I/O real (mesma filosofia de
`migrate.ts`/`integrationTestSupport.ts`) — testável com repositório/
conexão fake, sem banco real na suíte padrão. Testes de integração
opcionais usam o usuário runtime, nunca inserem dado real permanente,
sempre limpam a fixture. Cenários mínimos previstos: guard bloqueia
segunda execução; lock indisponível gera mensagem distinta de "já
concluído"; `createdByPublicId` persistido é `NULL`; evento/auditoria
carrega `"BOOTSTRAP"`; `loginEnabled` sempre `false`, nunca configurável
via CLI.

---

## 2. `POST /api/v1/identities` — contrato futuro (desenho, não implementado)

### 2.1 Request/Response

Inalterado desta revisão — ver ADR-027, seção "Contrato futuro do POST",
para o contrato completo (request/response, campos rejeitados,
`Location` header).

### 2.2 Boundary de autenticação futura

```
HTTP authenticated principal (Fase C — fora de escopo)
  ↓
actor resolver (Fase C/D — fora de escopo)
  ↓
authorization (Fase B/D — fora de escopo)
  ↓
CreateIdentityService.execute({ ..., actorPublicId: <resolvido> })  ← já existe hoje, para o caso NÃO-bootstrap
  ↓
domain (Identity, Value Objects)
  ↓
repository + audit
```

**Nota desta revisão:** o `POST` autenticado (quando existir) continua
usando `CreateIdentityService` normalmente — o problema de divergência
`created_by`/`actor_public_id` é exclusivo do caso de bootstrap (sem
Identity autenticada nenhuma). Uma vez que exista um actor real
(Identity autenticada), `CreateIdentityService` funciona exatamente como
hoje, sem nenhuma mudança.

**Bloqueado até:** existir authenticated principal real (Fase C) +
ActorContext resolvido no Application Layer (nunca a partir de
header/payload do cliente) + autorização apropriada (Fase B/D).

---

## 3. Identity fundacional × administrador — separação explícita

| Fase | Entrega | Status |
|---|---|---|
| A — Bootstrap da primeira Identity | Uma `Identity` existe, com auditoria verdadeira | **Concluída no MariaDB DEV real** — ver ADR-027, seção "Execução real da Fase A", para os dados operacionais registrados. |
| B — `ApplicationAccess` administrativo | Mecanismo real de concessão de acesso administrativo | **Implementada em código** (v0.5.0, ADR-028) — ainda não executada contra o DEV real. |
| C — `Credential`/autenticação | A Identity fundacional ganha forma de se autenticar | Fora de escopo |
| D — Primeiro login administrativo | Autenticação + `ApplicationAccess` concedido | Fora de escopo, depende de C (B já implementada, não executada) |

**Nota de atualização:** este documento foi escrito quando a Fase A ainda
estava apenas desenhada ("Desenhada aqui, não implementada" era a
descrição original desta linha da tabela). A Fase A foi posteriormente
implementada, executada e validada no MariaDB DEV real — ver ADR-027 para
o registro completo. Este documento permanece válido para o desenho
conceitual da Fase A; o estado de execução está registrado no ADR, não
aqui, para evitar duas fontes de verdade sobre o mesmo fato operacional.

A Identity criada pelo CLI **não tem** autoridade administrativa por si
só até que uma concessão real de Fase B ocorra (a Fase B já está
implementada em código, mas nenhuma concessão real foi executada ainda) e
C exista e D ocorra.

---

## 4. Erros — implementados e formalizados (exceto o de autorização futura)

| Código | HTTP conceitual | Classificação | Status |
|---|---|---|---|
| `BOOTSTRAP_ALREADY_COMPLETED` | 409 | Conflito | **Implementado** (`BootstrapAlreadyCompletedError`) e **formalizado** em `IDENTITY-DOMAIN-ERRORS.md`. Erro de orquestração do `BootstrapFirstIdentityService`, não do Aggregate `Identity` em sentido estrito — mantido no catálogo `identity` por proximidade. |
| `BOOTSTRAP_LOCK_NOT_ACQUIRED` | 409 | Conflito | **Implementado** (`BootstrapLockNotAcquiredError`) e **formalizado**. |
| `IDENTITY_CREATION_NOT_AUTHORIZED` | 403 | Autorização | **Ainda proposto, não implementado.** Pertenceria à futura camada de autorização (Fase B/D), fora do núcleo `identity` (ADR-007) — pertence ao futuro `POST /api/v1/identities`, não a esta entrega. |

---

## 5. Auditoria — resumo (detalhe completo na ADR-027)

- `AuditEvent`/`audit_events.actor_public_id`: `VARCHAR(36) NOT NULL`,
  sem `actor_type`. Já aceita, por design, um marcador reservado
  (`"SYSTEM"` já em uso) — `"BOOTSTRAP"` é consistente com esse
  precedente **nesta coluna especificamente**.
- `identities.created_by_identity_public_id`: `CHAR(36) NULL`, sem FK —
  **`NULL`** para a Identity fundacional, nunca um marcador.
- Nenhum evento de domínio novo — `identity.created` já é suficiente.
- Gap real de schema (falta de `actor_type` dedicado em `audit_events`)
  registrado como melhoria futura opcional, não bloqueante — ver ADR-027.

---

## 6. Riscos residuais

- Named lock protege contra duas execuções simultâneas do CLI, mas não
  contra dois operadores humanos decidindo (por engano) que "o bootstrap
  não foi feito ainda" quando na verdade já foi — mitigado pela mensagem
  clara de `BOOTSTRAP_ALREADY_COMPLETED`, não pelo mecanismo técnico em
  si.
- O gap de "Administrador real" (Fases B/C/D) permanece — nenhuma
  Identity, nem a fundacional, tem autoridade administrativa até essas
  fases existirem.
- `IDENTITY_CREATION_NOT_AUTHORIZED` continua proposto, não implementado
  — pertence ao futuro `POST /api/v1/identities` autenticado.
- A migration opcional (`actor_type` em `audit_events`) permanece
  adiada — dívida consciente, não implementada.
- Nenhuma execução real contra o MariaDB DEV foi feita ainda — o teste
  de integração está preparado, não executado.
