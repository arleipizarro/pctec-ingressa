# Session & Authentication Design — PCTEC Ingressa (v0.6.0, Fase D)

Versão associada: v0.6.0 — Session & Authentication (Fase D da ADR-027)
Status: **Documental — nenhum código implementado nesta entrega.** Ver
`docs/adr/ADR-030-SESSAO-E-AUTENTICACAO.md` para a decisão completa e sua
justificativa; este documento detalha o "como", mesmo padrão já usado em
`APPLICATION-ACCESS-DESIGN.md`/`CREDENTIAL-AUTH-DESIGN.md`.

**Nota de revisão crítica (segunda rodada):** este documento foi
atualizado para refletir as correções da revisão crítica registradas em
ADR-030 — em particular: (1) `201 Created` formalmente decidido para
`POST /api/v1/sessions`; (2) política CSRF mínima fechada (validação de
`Origin`/`Referer`), não mais totalmente deferida; (3) rate limiting com
requisito mínimo concreto, não apenas "futuro"; (4) invalidação de sessão
com os três mecanismos distintos formalizados (revogação persistida,
validação defensiva, evento disparador); (5) dummy hash com as 4
propriedades formais explícitas.

---

## 1. Modelo de domínio

### 1.1 Session

| Atributo | Tipo | Observação |
|---|---|---|
| `internalId` | `number` | Interno, nunca exposto (ADR-021). |
| `publicId` | `PublicId` (UUID) | Externo — aparece em eventos/auditoria/resposta HTTP, nunca é o segredo em si. |
| `identityPublicId` | `string` | Referência direta a `Identity`. |
| `tokenHash` | `string` | `SHA-256` (hex, 64 caracteres) do token opaco de 256 bits — nunca o token em texto. |
| `status` | `'ACTIVE' \| 'REVOKED'` | `EXPIRED` é estado derivado (`expires_at <= NOW()`), nunca persistido — ver ADR-030, "Session status". |
| `createdAt` | `Date` | |
| `expiresAt` | `Date` | Expiração absoluta nesta fase. |
| `lastSeenAt` | `Date \| undefined` | Atualizado a cada uso válido (política de throttling do write é decisão de implementação). |
| `revokedAt` | `Date \| undefined` | |
| `revocationReason` | `string \| undefined` | `LOGOUT` nesta fase; `ADMIN_ACTION`/`CREDENTIAL_CHANGED`/`SECURITY_EVENT` reservados para fases futuras. |
| `version` | `number` | Optimistic locking (ADR-024). |

**Não adotado nesta fase:** `RefreshToken` (já modelado em
`MODELO-DE-DOMINIO.md`, seção 12) — deferido, ver ADR-030. `ip`/`user_agent`
— deferidos por questão de LGPD ainda não decidida.

---

## 2. Fluxo de `POST /api/v1/sessions` (desenho apenas)

```
Request: { email, password }
  ↓
1. AuthenticateIdentityService.execute({ email, password })
   a. normaliza email
   b. SELECT Identity WHERE email_normalized = ?
      - não encontrada → dummy Argon2id hash → AUTHENTICATION_FAILED (401)
   c. Identity.status !== 'ACTIVE' → dummy Argon2id hash → AUTHENTICATION_FAILED
   d. Identity.loginEnabled !== true → dummy Argon2id hash → AUTHENTICATION_FAILED
   e. SELECT Credential WHERE identity_public_id = ? AND type = 'LOCAL_PASSWORD'
      - não encontrada → dummy Argon2id hash → AUTHENTICATION_FAILED
   f. Credential.status !== 'ACTIVE' → dummy Argon2id hash → AUTHENTICATION_FAILED
   g. Argon2PasswordHasher.verify(password, credential.passwordHash)
      - falso → AUTHENTICATION_FAILED
   h. UPDATE credentials SET last_authenticated_at = NOW(), version = version + 1
      WHERE public_id = ? AND version = ? (optimistic locking)
   i. retorna AuthenticatedIdentity { identityPublicId }
2. CreateSessionService.execute({ identityPublicId })
   a. gera token = crypto.randomBytes(32) → base64url
   b. tokenHash = SHA-256(token)
   c. INSERT sessions (status=ACTIVE, expires_at = now + duração configurada)
   d. INSERT AuditEvent (session.created)
   e. retorna CreatedSession { sessionPublicId, rawToken: token, expiresAt }
3. Camada HTTP:
   a. Set-Cookie: <SESSION_COOKIE_NAME>=<rawToken>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<segundos até expiresAt>
   b. 201 Created { session: { publicId, expiresAt }, identity: { publicId } }
      — rawToken NUNCA aparece no corpo da resposta; ADMIN/applicationAccesses/roles/permissions também nunca aparecem (ver ADR-030, questão 8).
      — Location conceitual: /api/v1/sessions/{publicId} (ADR-030, "POST /api/v1/sessions — 201, decisão fechada").
```

**Atenção de atomicidade (decisão de implementação, registrada aqui para
não ser esquecida):** os passos 1.h (atualizar `last_authenticated_at`) e
2.c (`INSERT sessions`) pertencem a fluxos logicamente distintos
(`AuthenticateIdentityService` vs. `CreateSessionService`), mas a ADR-030
exige que `last_authenticated_at` seja atualizado "na mesma transação de
`CreateSessionService`" — isso implica que, na implementação real, esses
dois serviços precisarão compartilhar a mesma conexão/transação (mesmo
padrão de orquestração já usado em `BootstrapFirstCredentialService`:
uma única conexão, um Application Service orquestrador chamando os dois
sub-fluxos) — não duas transações separadas com uma janela de
inconsistência entre elas.

---

## 3. Dummy Argon2id hash — mitigação de timing attack

Quando a `Identity`/`Credential` não é encontrada (ou está em estado
inválido), a implementação deve chamar `Argon2PasswordHasher.verify()`
(ou `.hash()`) contra um valor fixo e conhecido, usando os mesmos
`ARGON2ID_PARAMS` (ADR-029), **antes** de retornar `AUTHENTICATION_FAILED`
— nunca pular essa etapa "porque não há Credential para comparar". O
valor dummy nunca deve ser derivado de dado real (nunca usar hash de uma
Credential de outra identidade, por exemplo) — um hash PHC fixo,
gerado uma vez e reutilizado, é suficiente. Ver ADR-030, seção "Timing
attacks", para as 4 propriedades formais exigidas do valor dummy
(constante técnica, nunca corresponde a senha real, não vem do banco,
parâmetros compatíveis).

## 3.1 CSRF — política mínima (endpoints mutáveis autenticados por cookie)

`SameSite=Lax` sozinho não é suficiente (revisão crítica). Política
mínima fechada: validar `Origin` quando presente; `Referer` como
fallback quando `Origin` ausente; rejeitar requisição mutável autenticada
por cookie sem nenhum dos dois presentes. Token CSRF dedicado permanece
deferido — ver ADR-030, seção "CSRF", para o desenho completo.

---

## 4. `CreateSessionService` — detalhamento

```
CreateSessionService.execute({ identityPublicId: string }): Promise<CreatedSession>

CreatedSession {
  sessionPublicId: string;
  rawToken: string;
  expiresAt: Date;
}
```

- Nunca recebe `email`/`password` — só `identityPublicId`, já provado por
  `AuthenticateIdentityService`.
- Nunca consulta `ApplicationAccess`.
- `rawToken` só existe no valor de retorno em memória — nunca persistido
  (só o hash), nunca logado, nunca incluído em `AuditEvent`.

---

## 5. Erros

Ver ADR-030, seção "Contrato de erro", para a tabela completa —
`AUTHENTICATION_FAILED` (único código externo de falha de login, 401,
requer nova classificação `AUTHENTICATION` em `DomainErrorClassification`),
`SESSION_NOT_FOUND`/`SESSION_EXPIRED`/`SESSION_REVOKED` (contexto de
validação de sessão existente, distinguíveis externamente).

---

## 6. Eventos

Ver ADR-030, seção "Eventos". Resumo: `session.created`/`session.revoked`
(já catalogados, reutilizados); `authentication.succeeded`/
`authentication.failed` (log operacional/`AuditEvent` avulso, não
`Domain Event` — decisão registrada em ADR-030).

---

## 7. Persistência conceitual

Ver ADR-030, seção "Persistência conceitual", para o desenho completo da
tabela `sessions`. **Nenhuma migration criada nesta entrega.**

---

## 8. Riscos residuais

- Enumeração de usuário mitigada no login (`AUTHENTICATION_FAILED`
  único), mas dummy hash reduz, não elimina, a diferença de tempo (I/O de
  banco ainda varia entre os caminhos) — limite explícito documentado em
  ADR-030.
- Rate limiting não implementado ainda, mas com requisito mínimo
  concreto já fechado (IP + identificador combinados, resposta genérica,
  sem vazar existência de conta) — não mais uma lacuna muda.
- CSRF: `SameSite=Lax` + validação de `Origin`/`Referer` é a política
  mínima fechada desta fase; token CSRF dedicado permanece deferido,
  dívida registrada explicitamente.
- `RefreshToken` deferido — sessões de longa duração exigem reautenticação
  completa (sem renovação silenciosa) até essa fase futura. Status
  formalizado em 5 pontos explícitos em ADR-030.
- Revogação de sessão por troca de `Credential`/`loginEnabled=false`/
  bloqueio de `Identity` é regra arquitetural definida (com os três
  mecanismos distintos formalizados: revogação persistida, validação
  defensiva, evento disparador), mas não implementada — enquanto os
  comandos administrativos correspondentes não existirem, essa lacuna
  permanece.
- `ip`/`user_agent` fora do modelo — reduz capacidade de auditoria de
  segurança (ex.: detectar login de localização incomum) até decisão de
  LGPD ser tomada.
