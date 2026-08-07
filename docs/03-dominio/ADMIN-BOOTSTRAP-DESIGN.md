# Admin Bootstrap Design — PCTEC Ingressa (v0.5.0, Vertical Slice 2)

Versão associada: v0.5.0 — Identity API, Vertical Slice 2 (documental)
Status: Proposto para revisão do Product Owner e do Platform Architect
(segunda rodada — ver `docs/adr/ADR-027-BOOTSTRAP-ADMINISTRATIVO-INICIAL.md`
para a decisão completa e sua justificativa; este documento detalha o
"como", não repete o "porquê").

**Nada neste documento foi implementado nesta entrega.** Nenhum CLI,
nenhuma rota, nenhuma migration, nenhum schema, nenhuma Identity real.

**Nomenclatura desta revisão:** este documento chama o resultado do CLI
de **"Identity fundacional"**, nunca "administrador" — ver ADR-027, seção
"Fases", para a separação explícita entre bootstrap (Fase A) e autoridade
administrativa real (Fases B/C/D, fora de escopo).

---

## 1. CLI `bootstrap:admin` — desenho

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

### 1.2 Reuso vs. código novo (corrigido nesta rodada)

| Peça | Reuso ou novo |
|---|---|
| `Identity` (Aggregate Root), Value Objects | Reuso da maior parte; **pequena extensão localizada** no tratamento de `actor`/`createdByPublicId` para o caso de bootstrap (ver ADR-027, seção "CreateIdentityService — reavaliação") — não é reuso 100% gratuito. |
| `CreateIdentityService` | **Não reaproveitado diretamente.** Sua assinatura atual (`actorPublicId: string`) alimenta, com o mesmo valor, tanto `created_by_identity_public_id` quanto o `actor_public_id` do evento — os dois precisam divergir no bootstrap (`NULL` vs. `"BOOTSTRAP"`), o que `CreateIdentityService` hoje não suporta sem alteração. |
| `BootstrapFirstIdentityService` | **Novo** — Application Service dedicado, orquestrando o mesmo domínio/repositórios/`UnitOfWork`, mas com a lógica de guard (lock + `COUNT`) e a divergência `createdByPublicId=NULL`/`actor_public_id="BOOTSTRAP"` que `CreateIdentityService` não cobre. |
| `UnitOfWork`/`MariaDbUnitOfWork` | Reuso integral. |
| `IdentityRepository`/`MariaDbIdentityRepository` | Reuso do contrato de `insert()`; **método novo** de leitura para o guard (proposto: `countAll(): Promise<number>`, simples, não decidido em detalhe). |
| `AuditEventRepository` | Reuso integral. |
| `ActorPublicId` | **Não estendido com um marcador `BOOTSTRAP`** nesta revisão — a divergência é tratada dentro do `BootstrapFirstIdentityService`/`Identity`, não como um terceiro valor genérico de `ActorPublicId` usado em todo o domínio (ver ADR-027, Opção A rejeitada). |
| CLI wrapper (`bootstrapAdmin.ts`) | Novo — mesmo padrão de `src/cli/migrate.ts`. |

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

| Fase | Entrega | Nesta entrega? |
|---|---|---|
| A — Bootstrap da primeira Identity | Uma `Identity` existe, com auditoria verdadeira | Desenhada aqui, não implementada |
| B — `ApplicationAccess` administrativo | Mecanismo real de concessão de acesso administrativo | Fora de escopo |
| C — `Credential`/autenticação | A Identity fundacional ganha forma de se autenticar | Fora de escopo |
| D — Primeiro login administrativo | Autenticação + `ApplicationAccess` concedido | Fora de escopo, depende de B e C |

A Identity criada pelo CLI **não tem** autoridade administrativa até que
B e C existam e D ocorra.

---

## 4. Erros — proposta (não adicionada ao catálogo formal)

| Código | HTTP conceitual | Classificação | Onde pertence |
|---|---|---|---|
| `BOOTSTRAP_ALREADY_COMPLETED` | 409 | Conflito | Erro de orquestração do `BootstrapFirstIdentityService`, não do Aggregate `Identity` em sentido estrito — proposto para o catálogo `identity` por proximidade, decisão final pendente. |
| `IDENTITY_CREATION_NOT_AUTHORIZED` | 403 | Autorização | Pertenceria à futura camada de autorização (Fase B/D), fora do núcleo `identity` (ADR-007). |

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

- A pequena extensão de domínio necessária (divergência `createdByPublicId`/
  `actor_public_id` no caso de bootstrap) ainda não tem desenho de código
  fechado — fica para a implementação, com a ressalva já registrada na
  ADR-027.
- Named lock protege contra duas execuções simultâneas do CLI, mas não
  contra dois operadores humanos decidindo (por engano) que "o bootstrap
  não foi feito ainda" quando na verdade já foi — mitigado pela mensagem
  clara de `BOOTSTRAP_ALREADY_COMPLETED`, não pelo mecanismo técnico em
  si.
- O gap de "Administrador real" (Fases B/C/D) permanece — nenhuma
  Identity, nem a fundacional, tem autoridade administrativa até essas
  fases existirem.
- Os dois códigos de erro propostos não são compromissos.
