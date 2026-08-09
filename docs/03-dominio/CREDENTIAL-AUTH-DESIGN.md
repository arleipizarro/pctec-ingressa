# Credential & Authentication Design — PCTEC Ingressa (v0.5.x, Fase C)

Versão associada: v0.5.x — Credential & Authentication Foundation (Fase C
da ADR-027)
Status: **Documental — nenhum código implementado nesta entrega.** Ver
`docs/adr/ADR-029-CREDENTIAL-E-AUTENTICACAO.md` para a decisão completa e
sua justificativa; este documento detalha o "como", mesmo padrão já usado
em `APPLICATION-ACCESS-DESIGN.md` (v0.5.0).

**Nota de revisão crítica (segunda rodada):** este documento foi
atualizado para refletir as correções da revisão crítica registradas em
ADR-029 — em particular: (1) guard de bootstrap agora **global**, não
por-Identity; (2) `UNIQUE(identity_public_id, type)` agora **adotado**
(rotação por atualização em lugar); (3) `loginEnabled=true` não é mais
tratado como consequência automática incondicional; (4)
`AuthenticateIdentityService` não retorna mais `applicationAccesses`.

---

## 1. Modelo de domínio

### 1.1 Credential

| Atributo | Tipo | Observação |
|---|---|---|
| `internalId` | `number` | Interno, nunca exposto (ADR-021). |
| `publicId` | `PublicId` (UUID) | Externo, imutável. |
| `identityPublicId` | `string` | Referência direta a `Identity` (mesmo padrão de `ApplicationAccess`, ADR-025/028). |
| `type` | `'LOCAL_PASSWORD'` | Enum extensível — só este valor nesta fase (ver ADR-029, "Nomenclatura de type"). |
| `passwordHash` | `string` | Argon2id, formato PHC completo — nunca texto puro, nunca reversível. |
| `status` | `'ACTIVE' \| 'REVOKED'` | Só estes dois — ver ADR-029, "Status de Credential" (`PENDING`/`LOCKED`/`DISABLED` avaliados e rejeitados). |
| `lastAuthenticatedAt` | `Date \| undefined` | Reservado; populado só na Fase D (login real). |
| `version` | `number` | Optimistic locking (ADR-024). |
| `createdAt`/`updatedAt` | `Date` | |

**Não adotados nesta fase** (avaliados e descartados, com justificativa em
ADR-029): `loginIdentifier` (resolvido via `Identity.email_normalized`),
`failedAttempts`/`lockedUntil` (lockout deferido — quando implementado,
`lockedUntil` é um campo temporal na própria linha, nunca um valor de
`status`).

**Existe no máximo UMA linha de `Credential` por `(identity_public_id,
type)`, para sempre** (Opção A de rotação, ADR-029) — rotacionar a senha
é um `UPDATE` na mesma linha (`password_hash`, `version += 1`), nunca um
novo `INSERT`. Isso é o que torna `UNIQUE(identity_public_id, type)`
viável e adotado (correção em relação à primeira versão deste
documento).

Único comando desenhado: `createFoundational()` (nome provisório,
paralelo a `Identity.createFoundational()`/
`ApplicationAccess.grantFoundationalAdminAccess()`) — usado exclusivamente
pelo bootstrap. Um comando genérico de criação por fluxo normal
(`MagicLink ACTIVATION`) permanece o desenho de ADR-022, não implementado
ainda.

---

## 2. `BootstrapFirstCredentialService` — fluxo

```
identityPublicId + senha (prompt oculto) + confirmação (entrada do operador)
  ↓
1. Validação de formato de identityPublicId + política mínima de senha —
   falha rápida, sem I/O.
2. Obtém UMA conexão física do pool (mesma conexão do início ao fim).
3. GET_LOCK('pctec_ingressa_credential_bootstrap', 10s) nessa conexão.
   - Não obtido → CREDENTIAL_BOOTSTRAP_LOCK_NOT_ACQUIRED.
4. Dentro de uma transação, na MESMA conexão:
   a. SELECT Identity WHERE public_id = <identityPublicId>.
      - Não encontrada → IDENTITY_NOT_FOUND.
      - status = DELETED → IDENTITY_DELETED.
   b. Guard GLOBAL (corrigido — ver ADR-029, "Escopo exato do bootstrap"):
      já existe QUALQUER Credential LOCAL_PASSWORD no sistema, de
      qualquer Identity? → se sim, CREDENTIAL_BOOTSTRAP_ALREADY_COMPLETED.
      Não é mais "esta Identity já tem Credential" (guard por-identidade,
      versão anterior incorreta) — é "o bootstrap já foi usado alguma
      vez, por qualquer identidade".
   c. Hash da senha (Argon2id) — nunca a senha bruta persistida em
      nenhuma variável fora do escopo mínimo necessário.
   d. INSERT Credential (status=ACTIVE).
   e. identity.activate() — PENDING → ACTIVE. Implementa a semântica de
      `Activation` já definida em `IDENTITY-UBIQUITOUS-LANGUAGE.md`
      (v0.3.0): a criação da primeira credencial É a ativação.
   f. identity.enableLogin() — loginEnabled → true. **Decisão de
      orquestração específica deste serviço de bootstrap** (a Identity
      fundacional precisa de login funcional imediatamente) — não uma
      regra geral de que toda criação de Credential habilita login (ver
      ADR-029, "loginEnabled — invariante e controle").
   g. INSERT AuditEvent(s) — credential.created, identity.activated,
      identity.login-enabled (a partir dos eventos de domínio pulados de
      Credential e de Identity) — três eventos distintos, nenhum
      redundante (ver ADR-029, "Eventos").
5. COMMIT.
6. RELEASE_LOCK no finally (mesma conexão), sempre — mesmo em erro.
7. Devolve a conexão ao pool.
```

Em qualquer erro entre `BEGIN` e `COMMIT`: `ROLLBACK`, depois
`RELEASE_LOCK`, depois `connection.release()` — nessa ordem, sempre. Mesma
prova de atomicidade (sequência ordenada, testável) já estabelecida para
`BootstrapFirstIdentityService` (ADR-027) e
`BootstrapFirstApplicationAccessService` (ADR-028).

### 2.1 Por que não `UnitOfWork` genérico

Mesmo motivo já registrado em ADR-027/028: o named lock precisa
permanecer adquirido até depois do `COMMIT`, nunca antes — `MariaDbUnitOfWork`
faz o commit automaticamente ao final do callback, o que forçaria
`RELEASE_LOCK` a rodar antes do commit se usado aqui.

### 2.2 Reuso vs. código novo (quando implementado)

| Peça | Reuso ou novo |
|---|---|
| `IdentityRepository`/`MariaDbIdentityRepository` | Reuso integral — sem alteração. |
| `Identity.activate()`/`enableLogin()` | Reuso integral — já implementados, v0.4.0. |
| `AuditEventRepository`/`MariaDbAuditEventRepository` | Reuso integral. |
| `Credential`/`CredentialRepository` | Novos — módulo `security` (bounded context já previsto em ADR-014, nunca implementado). |
| `BootstrapFirstCredentialService` | Novo — paralelo estrutural aos dois bootstraps anteriores. |
| `BootstrapConnection`/`BootstrapConnectionPool` | Reuso dos tipos já definidos (contrato técnico puro, mesmo padrão de reuso cross-module já aplicado por `application` reusando de `identity`). |

---

## 3. CLI `bootstrap:first-credential` — controles de segurança

- **Execução somente local**, nunca abre socket.
- **Entrada:** `identityPublicId` (texto), senha (**prompt oculto** — sem
  eco no terminal), confirmação de senha (comparação exata antes de
  prosseguir).
- **Nunca aceita** senha via argv, nunca via variável de ambiente
  permanente.
- **Nunca imprime** a senha, o hash, ou qualquer log/stack que os exponha.
- **Não reutiliza** o CLI de bootstrap de Identity nem o de
  ApplicationAccess — script e serviço próprios.
- **Bloqueia `NODE_ENV=production`** nesta fase (mesmo padrão dos dois
  CLIs anteriores).
- Confirmação explícita antes de prosseguir (mesmo padrão de
  `GRANT_ADMIN` do CLI de acesso administrativo) — frase de confirmação
  exata a definir na implementação (ex.: `SET_CREDENTIAL` ou
  equivalente), não fixada nesta ADR por não ser uma decisão
  arquitetural.

---

## 4. Erros

Ver ADR-029, seção "Erros", para a tabela completa — nomes corrigidos
nesta rodada (`CREDENTIAL_BOOTSTRAP_ALREADY_COMPLETED`, não mais
`CREDENTIAL_ALREADY_EXISTS` para o caso de bootstrap) — e a separação
entre o que é formalizado agora (criação da credencial) e o que fica
para a Fase D (autenticação real, com proteção contra enumeração —
ver ADR-029, "Proteção contra enumeração de usuário").

---

## 5. Eventos

Ver ADR-029, seção "Eventos". Resumo: `credential.created` (novo, a
formalizar no catálogo quando implementado), `identity.activated` e
`identity.login-enabled` (reutilizados sem alteração, já existentes desde
v0.2.0/v0.4.0) — os três com `actor_public_id = "BOOTSTRAP"` no fluxo de
bootstrap, nenhum redundante.

---

## 6. Authentication boundary (Fase D, corrigido nesta rodada)

`AuthenticateIdentityService` prova identidade, **não** decide
autorização:

```
AuthenticateIdentityService.execute({ email, password }): Promise<AuthenticatedIdentity>

AuthenticatedIdentity {
  identityPublicId: string;
}
```

`applicationAccesses` **não** faz parte do retorno (correção em relação à
primeira versão deste documento, que usava `AuthenticatedPrincipal` com
`applicationAccesses` embutido — misturava autenticação e autorização). A
resolução de `ApplicationAccess` é uma chamada separada e posterior,
feita pela camada de orquestração de sessão (Fase D), nunca por este
serviço.

---

## 6.1 Nota de implementação — ordem real dos parâmetros PHC (achado durante a implementação)

A biblioteca `argon2` (node-argon2) real emite a string PHC com os
parâmetros de custo na ordem `m=...,p=...,t=...` (memória, paralelismo,
tempo) — **não** `m=...,t=...,p=...` como uma primeira versão da
validação de formato (`PasswordHash.ts`) assumia. Esse é um bug real,
encontrado ao testar `PasswordHash.fromPhcString()` contra hashes gerados
pela biblioteca de verdade (não apenas fixtures manuais construídas à
mão) — a regra de validação foi corrigida para não assumir nenhuma ordem
fixa entre `m`/`t`/`p`, apenas que os três aparecem, cada um uma vez,
como pares `chave=valor` separados por vírgula. Registrado aqui porque é
exatamente o tipo de detalhe que só aparece testando contra a biblioteca
real — reforça por que `Argon2PasswordHasher.test.ts` chama a biblioteca
de verdade em vez de usar apenas fixtures.

## 7. Riscos residuais

- Lockout/rate limiting não desenhado em detalhe — deferido, ver ADR-029.
- Biblioteca específica de Argon2id e seus parâmetros de custo não
  escolhidos — decisão de implementação, não desta entrega; benchmark
  obrigatório no ambiente real antes de produção.
- Mecanismo de sessão/token da Fase D (JWT ou equivalente) permanece
  Pendente de decisão, herdado de `API-CONTRACT-V1.md` desde v0.2.0.
- A invariante "`loginEnabled=true` exige `Credential ACTIVE`" é de
  processo, não de domínio — um código futuro mal-orquestrado poderia
  tecnicamente chamar `enableLogin()` sem uma Credential existir. Mesmo
  tipo de risco documentado (não uma omissão) já registrado para a
  invariante de unicidade de ADMIN em ADR-028.
- Reset e troca de senha não desenhados nesta ADR — ficam como gap
  explícito para uma entrega futura.
- O guard global do bootstrap depende do named lock cooperativo para
  proteção contra concorrência real (mesma limitação já registrada para
  ApplicationAccess, ADR-028) — protege quem passa pelo
  `BootstrapFirstCredentialService`, não qualquer inserção futura na
  tabela `credentials` que não use esse mesmo lock.
