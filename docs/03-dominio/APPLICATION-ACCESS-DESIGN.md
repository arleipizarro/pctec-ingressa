# Application Access Design — PCTEC Ingressa (v0.5.0)

Versão associada: v0.5.0 — Administrative Access Foundation
Status: Implementado em código nesta entrega — ver
`docs/adr/ADR-028-APPLICATION-ACCESS-E-ACESSO-ADMINISTRATIVO.md` para a
decisão completa e sua justificativa; este documento detalha o "como".

**Implementado nesta entrega:** `Application` (leitura/reconstituição),
`ApplicationAccess` (Aggregate, com `grantFoundationalAdminAccess()`),
`BootstrapFirstApplicationAccessService`, o CLI
`npm run bootstrap:first-admin-access`
(`src/cli/bootstrap-first-admin-access.ts`), migrations 0005–0007, e o
catálogo de erros abaixo.
**Não executado ainda:** nenhuma migration, nenhum acesso ao MariaDB DEV
real, nenhuma concessão administrativa real — tudo validado por testes
automatizados (fakes).

---

## 1. Modelo de domínio

### 1.1 Application

| Atributo | Tipo | Observação |
|---|---|---|
| `internalId` | `number` | Interno, nunca exposto (ADR-021). |
| `publicId` | `PublicId` (UUID) | Externo, imutável. |
| `code` | `ApplicationCode` | Único, imutável — ex.: `PCTEC_INGRESSA`. |
| `name` | `ApplicationName` | Nome de exibição. |
| `status` | `'ACTIVE' \| 'INACTIVE'` | |
| `version` | `number` | Optimistic locking (ADR-024) — reservado; sem comando de mutação nesta fatia. |
| `createdAt`/`updatedAt` | `Date` | |

Somente-leitura no domínio nesta fatia — `reconstitute()` é o único
factory. Criada por seed técnico de migration (ver seção 3).

### 1.2 ApplicationAccess

| Atributo | Tipo | Observação |
|---|---|---|
| `internalId` | `number \| undefined` | Interno, nunca exposto. |
| `publicId` | `PublicId` (UUID) | Externo, imutável. |
| `identityPublicId` | `string` | Referência direta a `Identity` (ADR-025 — nunca `IdentityProfile`). |
| `applicationPublicId` | `string` | Referência a `Application`. |
| `accessProfile` | `AccessProfile` | Enum fechado — só `ADMIN` nesta fatia (ADR-028). |
| `status` | `'GRANTED' \| 'REVOKED'` | Sempre `GRANTED` nesta fatia (sem comando de revogação). |
| `grantedAt` | `Date` | |
| `grantedByIdentityPublicId` | `string \| undefined` | `undefined` (⇒ `NULL`) na concessão de bootstrap. |
| `revokedAt`/`revokedByIdentityPublicId` | opcional | Sempre ausentes nesta fatia. |
| `version` | `number` | Optimistic locking — reservado; sem comando de mutação (revoke) nesta fatia. |
| `createdAt`/`updatedAt` | `Date` | |

Único comando implementado: `grantFoundationalAdminAccess()` — estático,
paralelo a `Identity.createFoundational()`.

---

## 2. `BootstrapFirstApplicationAccessService` — fluxo

```
identityPublicId (entrada do operador, nunca hardcoded)
  ↓
1. Validação de formato (PublicId.fromString) — falha rápida, sem I/O.
2. Obtém UMA conexão física do pool (mesma conexão do início ao fim).
3. GET_LOCK('pctec_ingressa_application_access_bootstrap', 10s) nessa conexão.
   - Não obtido → APPLICATION_ACCESS_LOCK_NOT_ACQUIRED.
4. Dentro de uma transação, na MESMA conexão:
   a. SELECT Application WHERE code = 'PCTEC_INGRESSA'.
      - Não encontrada → APPLICATION_NOT_FOUND.
   b. SELECT Identity WHERE public_id = <identityPublicId>.
      - Não encontrada → IDENTITY_NOT_FOUND.
   c. Verificar: já existe ApplicationAccess GRANTED com accessProfile=ADMIN
      para esta Application? → se sim, APPLICATION_ACCESS_BOOTSTRAP_ALREADY_COMPLETED.
   d. Verificar: já existe ApplicationAccess GRANTED para esta tripla exata
      (identidade, aplicação, perfil)? → se sim, mesmo erro acima.
   e. ApplicationAccess.grantFoundationalAdminAccess(...) — cria a
      concessão + evento de domínio em memória.
   f. INSERT ApplicationAccess.
   g. INSERT AuditEvent (a partir do evento de domínio).
5. COMMIT.
6. RELEASE_LOCK no finally (mesma conexão), sempre — mesmo em erro.
7. Devolve a conexão ao pool.
```

Em qualquer erro entre `BEGIN` e `COMMIT`: `ROLLBACK`, depois
`RELEASE_LOCK`, depois `connection.release()` — nessa ordem, sempre.

### 2.1 Por que não `UnitOfWork` genérico

Mesmo motivo do ADR-027 (`BootstrapFirstIdentityService`):
`MariaDbUnitOfWork.runInTransaction` só faz `commit()` depois que o
callback `work()` retorna — isso forçaria `RELEASE_LOCK` a rodar dentro do
callback, antes do commit automático, criando uma janela de corrida real
entre a liberação do lock e a durabilidade do `INSERT`. O serviço orquestra
a conexão/transação diretamente.

### 2.2 Reuso vs. código novo

| Peça | Reuso ou novo |
|---|---|
| `IdentityRepository`/`MariaDbIdentityRepository` | Reuso integral (módulo `identity`) — sem alteração. |
| `AuditEventRepository`/`MariaDbAuditEventRepository` | Reuso integral (módulo `audit`) — sem alteração. |
| `Application`/`ApplicationRepository` | Novos — módulo `application`. |
| `ApplicationAccess`/`ApplicationAccessRepository` | Novos — módulo `application`. |
| `BootstrapFirstApplicationAccessService` | Novo — paralelo estrutural a `BootstrapFirstIdentityService`. |
| `BootstrapConnection`/`BootstrapConnectionPool` | Reuso dos tipos já definidos em `BootstrapFirstIdentityService.ts` (contrato puramente técnico/estrutural, sem acoplamento de regra de negócio entre módulos). |

---

## 3. Seed técnico da Application `PCTEC_INGRESSA`

- `code`, `name` e `public_id` centralizados em
  `src/modules/application/domain/value-objects/ApplicationCodes.ts` —
  única fonte no código TypeScript.
- `public_id` técnico determinístico:
  `0b13f6f0-8f3a-4a1e-9c2d-000000000001` — gerado uma única vez,
  documentado, replicado (não importado — migrations não executam
  TypeScript) na migration `0007_seed_pctec_ingressa_application.up.sql`.
- **Idempotência via `MigrationRunner`, não via SQL de mascaramento**
  (revisão crítica, corrigida antes do commit): o `INSERT` desta migration
  é **normal** — sem `INSERT IGNORE`, sem `REPLACE INTO`, sem `ON
  DUPLICATE KEY UPDATE`. A idempotência operacional vem do
  `MigrationRunner`/`schema_migrations`: uma migration já registrada como
  aplicada nunca é reexecutada. Se, por qualquer motivo fora desse
  controle, já existir uma linha conflitante (`code` igual mas
  `public_id` diferente, ou vice-versa), este `INSERT` **falha
  explicitamente** contra `UNIQUE KEY uk_applications_code` /
  `uk_applications_public_id` — nunca mascara essa divergência. Ver
  ADR-028, seção "Estratégia de seed e idempotência", para a justificativa
  completa.
- `down.sql` remove exclusivamente a linha semeada, por `public_id` fixo —
  nunca um `DELETE` genérico por `code` isolado.

---

## 4. CLI `bootstrap:first-admin-access` — controles de segurança

- **Execução somente local**, nunca abre socket.
- **Entrada 100% interativa**: apenas `identityPublicId` — nenhum
  argumento de linha de comando aceito (elimina "segredo em
  argv/ps/shell history").
- **Nunca aceita** actor em argv, segredo, senha, código de aplicação
  arbitrário, ou perfil arbitrário — sempre concede exatamente
  `PCTEC_INGRESSA` + `ADMIN`, fixos no código.
- **Exibição prévia:** busca e mostra a Identity encontrada (publicId,
  status atual, e-mail mascarado) antes de pedir confirmação.
- **Confirmação exata:** `GRANT_ADMIN` (comparação case-sensitive) — qualquer
  outra entrada cancela sem abrir conexão de escrita.
- **Nunca imprime:** `internalId`, CPF, SQL, `DB_PASSWORD`, stack trace —
  confirmado por teste (`26. CLI não vaza dados sensíveis`).
- **Bloqueia `NODE_ENV=production`** nesta fase (exit code 2) — mesmo
  padrão do CLI de bootstrap de Identity.
- **Exit codes:** `0` sucesso; `1` cancelado/Identity não encontrada/já
  concluído/erro inesperado; `2` produção recusada; `3` lock não
  adquirido.

---

## 5. Erros

| Código | HTTP conceitual | Classificação | Onde |
|---|---|---|---|
| `APPLICATION_NOT_FOUND` | 404 | Validação | `modules/application/domain/errors/ApplicationErrors.ts` |
| `IDENTITY_NOT_FOUND` | 404 | Validação | Idem — implementado como classe própria neste módulo (`IdentityNotFoundForAccessError`), para não introduzir dependência de exceção entre bounded contexts além do necessário. |
| `APPLICATION_ACCESS_ALREADY_GRANTED` | 409 | Conflito | Idem — reservado para um futuro comando `grant(actor, ...)` fora do fluxo de bootstrap; não lançado pelo bootstrap (que usa os dois erros de orquestração abaixo). |
| `APPLICATION_ACCESS_BOOTSTRAP_ALREADY_COMPLETED` | 409 | Conflito | `modules/application/application/errors/ApplicationAccessBootstrapErrors.ts` |
| `APPLICATION_ACCESS_LOCK_NOT_ACQUIRED` | 409 | Conflito | Idem |
| `APPLICATION_ACCESS_INVALID_PROFILE` | 422 | Validação | `modules/application/domain/value-objects/AccessProfile.ts` |
| `APPLICATION_CODE_INVALID` | 422 | Validação | `modules/application/domain/value-objects/ApplicationCode.ts` |
| `APPLICATION_CODE_ALREADY_EXISTS` | 409 | Conflito | `ApplicationErrors.ts` — reservado para um futuro comando de criação dinâmica; não exercitado nesta fatia (seed via migration, protegido por `UNIQUE KEY`). |
| `APPLICATION_ACCESS_VERSION_CONFLICT` | 409 | Conflito | `ApplicationErrors.ts` — reservado para um futuro comando de mutação (revoke); não exercitado nesta fatia. |

---

## 6. Eventos

`application-access.granted` — já catalogado conceitualmente desde a
v0.2.0 (`CATALOGO-DE-EVENTOS.md`), payload estendido nesta entrega com
`access_profile`:

```json
{
  "applicationAccessPublicId": "...",
  "identityPublicId": "...",
  "applicationPublicId": "...",
  "accessProfile": "ADMIN"
}
```

Envelope comum (via `DomainEvent`): `eventId`, `eventType =
"application-access.granted"`, `eventVersion = 1`, `aggregatePublicId`
(= `applicationAccessPublicId`), `actorPublicId = "BOOTSTRAP"`,
`correlationId`, `causationId` (opcional), `occurredAt`.

Nenhum dado sensível — apenas UUIDs e o perfil (enum fechado).

---

## 7. Riscos residuais

- **A unicidade de `ADMIN` por aplicação depende exclusivamente do named
  lock cooperativo, não de constraint de banco** — ver ADR-028, seção
  "Garantias de unicidade do ADMIN — o que é real e o que não é", para a
  análise completa (A: banco, B: service, C: lock). Named lock protege
  contra duas execuções simultâneas do CLI/serviço de bootstrap, mas não
  contra um eventual caminho de escrita futuro que não reuse o mesmo
  lock — decisão consciente desta entrega, a revisitar se
  `application_accesses` ganhar um segundo caminho de escrita.
- Nenhum comando de revogação existe — se a concessão administrativa
  precisar ser revertida, hoje isso exigiria intervenção manual direta no
  banco (fora do escopo desta entrega).
- `optimistic locking` (campo `version`) está presente no schema e no
  Aggregate por consistência, mas não é exercitado por nenhum comando de
  mutação nesta fatia (não há `update`/`revoke` implementado) — só
  testável estruturalmente (valor inicial = 1), não funcionalmente (sem
  conflito real de concorrência a provocar).
- Nenhuma execução real contra o MariaDB DEV foi feita ainda para a Fase
  B (`ApplicationAccess`) — testes de integração preparados, não
  executados. (A Fase A, criação da Identity fundacional, já foi
  executada e validada no DEV real — ver ADR-027.)
