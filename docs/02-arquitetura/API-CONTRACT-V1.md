# Contrato Conceitual da API — v1

Versão associada: v0.2.0 — Domain Foundation
Status: Proposto para revisão do Product Owner e do Platform Architect

Este documento descreve contratos **conceituais** de API. Não há
implementação nesta entrega. O objetivo é validar formato, recursos,
convenções e limites antes de qualquer código ser escrito.

## Convenções gerais

- Prefixo de versão: `/api/v1/...`. Mudanças que quebrem compatibilidade
  exigem `/api/v2/...`; nenhuma mudança quebra a v1 silenciosamente.
- Toda identificação de recurso em payload e URL usa exclusivamente o UUID
  público. IDs internos numéricos nunca aparecem em nenhuma resposta.
- Toda requisição e resposta inclui um cabeçalho `X-Correlation-Id`. Se o
  cliente não enviar, o servidor gera um e o retorna na resposta, para
  permitir rastreamento ponta a ponta entre Ingressa e consumidor.
- Paginação por cursor (padrão) em listagens: parâmetros `limit` (default
  Pendente de decisão, ex.: 20) e `cursor`; resposta inclui
  `next_cursor` (nulo quando não há mais páginas).
- Erros seguem formato padronizado (ver seção "Formato de erro").
- Autenticação da própria API (como um consumidor autentica suas chamadas
  ao Ingressa) é Pendente de decisão nesta fase — este contrato assume que
  um mecanismo de autenticação de serviço a serviço existirá, sem definir
  qual.

## Formato de erro padronizado

```json
{
  "error": {
    "code": "IDENTITY_NOT_FOUND",
    "message": "Identidade não encontrada.",
    "correlation_id": "b3f2c1a0-....",
    "details": []
  }
}
```

- `code`: string estável, em maiúsculas, para tratamento programático.
- `message`: mensagem legível, podendo ser localizada futuramente.
- `correlation_id`: mesmo valor do cabeçalho `X-Correlation-Id` da
  requisição.
- `details`: lista opcional de erros de campo, quando aplicável (ex.:
  validação).

## Formato de paginação padronizado

```json
{
  "data": [ /* itens do recurso */ ],
  "pagination": {
    "limit": 20,
    "next_cursor": "eyJpZCI6ICIuLi4ifQ=="
  }
}
```

---

## 1. `/api/v1/identities`

**Responsabilidade:** gestão do Cadastro Mestre de identidades.

Operações conceituais: criar, consultar por UUID, listar (com filtro por
`status`, `email`), atualizar dados cadastrais, alterar `status`, alterar
`login_enabled`.

Exemplo mínimo de payload de criação:

```json
{
  "full_name": "Nome Completo",
  "email": "pessoa@exemplo.com",
  "document_number": null
}
```

Exemplo mínimo de payload de resposta:

```json
{
  "id": "6f1c9e2a-....",
  "full_name": "Nome Completo",
  "email": "pessoa@exemplo.com",
  "status": "PENDING",
  "login_enabled": false,
  "created_at": "2026-01-01T00:00:00Z"
}
```

Erros esperados: `IDENTITY_EMAIL_ALREADY_EXISTS`,
`IDENTITY_DOCUMENT_ALREADY_EXISTS`, `IDENTITY_NOT_FOUND`,
`IDENTITY_INVALID_STATUS_TRANSITION`.

## 2. `/api/v1/organizations`

**Responsabilidade:** gestão do Cadastro Mestre de grupos empresariais e
empresas, incluindo relação hierárquica.

Operações conceituais: criar, consultar por UUID, listar (filtro por
`type`, `status`), atualizar, vincular/desvincular empresa a grupo
(`OrganizationRelationship`).

Exemplo mínimo de payload de criação:

```json
{
  "type": "COMPANY",
  "legal_name": "Empresa Exemplo Ltda",
  "document_number": "00000000000000"
}
```

Erros esperados: `ORGANIZATION_NOT_FOUND`,
`ORGANIZATION_DOCUMENT_ALREADY_EXISTS`,
`ORGANIZATION_INVALID_RELATIONSHIP` (ex.: tentar vincular `COMPANY` como
pai).

## 3. `/api/v1/memberships`

**Responsabilidade:** gestão do vínculo entre identidade e organização.

Operações conceituais: criar, consultar por UUID, listar (filtro por
`identity_id`, `organization_id`, `status`), encerrar (alterar `status`
para `INACTIVE`, preenchendo `ended_at`).

Exemplo mínimo de payload de criação:

```json
{
  "identity_id": "6f1c9e2a-....",
  "identity_profile_id": "a91e77b4-....",
  "organization_id": "1d3a44c0-....",
  "scope": "ORGANIZATION_ONLY"
}
```

Erros esperados: `MEMBERSHIP_ALREADY_EXISTS`,
`MEMBERSHIP_INVALID_SCOPE_FOR_ORGANIZATION_TYPE`, `MEMBERSHIP_NOT_FOUND`.

## 4. `/api/v1/profiles`

**Responsabilidade:** gestão dos `IdentityProfile` de uma identidade
(atribuição e remoção de contextos como `EMPLOYEE`, `CUSTOMER`, etc.).

Operações conceituais: adicionar perfil a uma identidade, listar perfis de
uma identidade, inativar um perfil.

Exemplo mínimo de payload de criação:

```json
{
  "identity_id": "6f1c9e2a-....",
  "profile": "CUSTOMER"
}
```

Erros esperados: `PROFILE_ALREADY_ASSIGNED`, `PROFILE_NOT_FOUND`.

## 5. `/api/v1/applications`

**Responsabilidade:** gestão do catálogo de aplicações do ecossistema.

Operações conceituais: criar, consultar por UUID, listar, atualizar,
inativar.

Exemplo mínimo de payload de criação:

```json
{
  "code": "PCTEC-PORTAL",
  "name": "PCTEC Portal"
}
```

Erros esperados: `APPLICATION_CODE_ALREADY_EXISTS`,
`APPLICATION_NOT_FOUND`.

## 6. `/api/v1/application-access`

**Responsabilidade:** concessão e revogação de acesso global de uma
identidade a uma aplicação.

Operações conceituais: conceder acesso, revogar acesso, listar acessos
(filtro por `identity_id`, `application_id`, `status`), consultar se uma
identidade possui acesso a uma aplicação específica.

Exemplo mínimo de payload de concessão:

```json
{
  "identity_id": "6f1c9e2a-....",
  "identity_profile_id": "a91e77b4-....",
  "application_id": "3c2b1a90-...."
}
```

Erros esperados: `APPLICATION_ACCESS_ALREADY_GRANTED`,
`APPLICATION_ACCESS_NOT_FOUND`.

**Nota de correção (v0.6.x — Fase F, ADR-028):** esta seção documenta a
concessão/revogação de acesso (ainda não implementada em rota HTTP,
task de fase futura). O **uso** de um acesso já concedido para
autorizar rotas protegidas é diferente e já implementado — `GET
/api/v1/admin/whoami` e qualquer rota administrativa futura retornam
`APPLICATION_ACCESS_DENIED` (403, classificação `AUTHORIZATION`) como
código externo único, colapsando aplicação inexistente/inativa, acesso
inexistente/`REVOKED`, e perfil insuficiente — nunca expõe qual causa
específica ocorreu. Mesma filosofia de `AUTHENTICATION_FAILED`/
`SESSION_INVALID` (ver ADR-030), mas **nunca 401** — a autorização
pressupõe que a autenticação já ocorreu; `403` sempre significa "você é
quem diz ser, mas não pode fazer isto". Ver ADR-028, seção "Status", e
`AuthorizeApplicationAccessService.ts`, para o desenho completo.

## 7. `/api/v1/sessions`

**Responsabilidade:** gestão do ciclo de vida de sessões autenticadas.

Operações conceituais: criar sessão (login), consultar sessão atual,
listar sessões ativas de uma identidade, revogar uma sessão específica,
revogar todas as sessões de uma identidade.

Exemplo mínimo de payload de criação (login):

```json
{
  "email": "pessoa@exemplo.com",
  "password": "********"
}
```

Exemplo mínimo de payload de resposta:

```json
{
  "session_id": "7a8b9c0d-....",
  "identity_id": "6f1c9e2a-....",
  "expires_at": "2026-01-01T01:00:00Z"
}
```

Observação: o `refresh_token` não é retornado no corpo desta documentação
conceitual por ser um valor sensível — seu mecanismo de entrega (cookie
`HttpOnly`/`Secure` versus corpo de resposta) é Pendente de decisão.

Erros esperados: `AUTHENTICATION_FAILED` (login, `POST /sessions`),
`SESSION_INVALID` (validação de sessão já existente, `GET /me`/`DELETE
/sessions/current`/qualquer middleware de autenticação).

**Nota de correção (v0.6.0 — ADR-030):** esta seção originalmente listava
`INVALID_CREDENTIALS`, `IDENTITY_LOGIN_DISABLED`, `IDENTITY_BLOCKED`,
`SESSION_NOT_FOUND` como erros externos distintos. Corrigido: os três
primeiros colapsam em um único `AUTHENTICATION_FAILED` (401) — expor
causas de falha de login separadamente permite enumeração de e-mails
cadastrados e inferência do estado administrativo de uma conta. Ver
ADR-030, seção "Conflitos reais encontrados" e "Proteção contra
enumeração", para a justificativa completa.

**Nota de correção adicional (v0.6.x — Fase E):** `SESSION_NOT_FOUND`
inicialmente permaneceu como código externo distinto, sob a premissa de
que distinguir causas de sessão inválida (não encontrada/expirada/
revogada) não vazaria informação sobre outras contas, já que o cliente
já possui algum token. Essa decisão foi revista na implementação real da
Fase E: `SESSION_NOT_FOUND`/`SESSION_EXPIRED`/`SESSION_REVOKED` também
colapsam — agora em `SESSION_INVALID` (401) — porque distinguir a causa
ainda entrega um sinal comportamental a quem possui um token roubado
("revogada" sugere ação humana do dono legítimo; "expirada" sugere só
passagem de tempo). Ver ADR-030, seção "Proteção contra enumeração",
para a justificativa completa revista.

## 8. `/api/v1/magic-links`

**Responsabilidade:** criação e consumo de links expiráveis de uso único
para ativação, redefinição de senha e demais tipos previstos.

Operações conceituais: solicitar magic link (por tipo), consumir magic
link (via token recebido fora da API, ex.: e-mail), consultar status de um
magic link.

Exemplo mínimo de payload de solicitação:

```json
{
  "identity_id": "6f1c9e2a-....",
  "type": "ACTIVATION"
}
```

Exemplo mínimo de payload de consumo:

```json
{
  "token": "valor-recebido-fora-da-api"
}
```

Erros esperados: `MAGIC_LINK_EXPIRED`, `MAGIC_LINK_ALREADY_CONSUMED`,
`MAGIC_LINK_INVALID_TOKEN`.

---

## 9. `/api/v1/portal/context`

**Status: implementado — G3 (v0.6.x).** Diferente das seções 1–8 acima
(em grande parte ainda conceituais/pré-implementação), esta seção
documenta o contrato REAL, já em código.

**Responsabilidade:** resolver, para uma Identity já autenticada, quais
`Organization`s ela pode enxergar no Portal — nunca decide "o que ela
pode fazer" dentro de cada uma (isso é escopo comercial de cada rota
futura, G4+).

**`GET /api/v1/portal/context`**

Pipeline: `requireAuthenticatedSession` → `requireApplicationAccess`
(`applicationCode=PCTEC_PORTAL`, `profile=USER` — ADR-032) → handler.
Nessa ordem, sempre — nunca o contrário.

Contrato de resposta:

```json
{
  "identity": { "publicId": "..." },
  "organizations": [
    { "publicId": "...", "type": "BUSINESS_GROUP", "legalName": "...", "tradeName": null },
    { "publicId": "...", "type": "COMPANY", "legalName": "...", "tradeName": null }
  ]
}
```

`organizations: []` é uma resposta `200` legítima (Identity com
`PCTEC_PORTAL` mas sem nenhum `Membership` ainda) — nunca um erro.
**Contrato fechado, sem ambiguidade (revisão pré-commit de G3, item 5):**
sessão válida + `ApplicationAccess(PCTEC_PORTAL, USER)` válido + zero
`Membership` `ACTIVE` sempre retornam `200` com `organizations: []`,
nunca `403`. Acesso à aplicação (`ApplicationAccess`) e escopo comercial
(`Membership`) são conceitos independentes (ADR-031 §6) — uma Identity
pode estar corretamente autenticada e autorizada a usar o Portal sem
ainda ter nenhuma `Organization` atribuída; isso não é um estado de
erro, é um estado inicial legítimo (ex.: acesso acabou de ser concedido,
vínculo comercial ainda não cadastrado).
Nunca inclui `legacyId`/`internalId`/`documentNumber`/CNPJ/Credential/
Session token/`ApplicationAccess` cru.

**Contrato 401 × 403 (ADR-032, formalizado aqui):**

| Situação | Código | Classificação | HTTP |
|---|---|---|---|
| Sem sessão | `SESSION_INVALID` | `AUTHENTICATION` | 401 |
| Sessão válida, sem `ApplicationAccess(PCTEC_PORTAL, USER)` | `APPLICATION_ACCESS_DENIED` | `AUTHORIZATION` | 403 |
| Sessão + Portal access válidos, mas `organizationPublicId` fora do `PortalContext` efetivo | `ORGANIZATION_ACCESS_DENIED` | `AUTHORIZATION` | 403 |

Nunca misturado. Um `ADMIN` de `PCTEC_INGRESSA` sem
`ApplicationAccess(PCTEC_PORTAL, USER)` próprio recebe `403` na segunda
linha — os dois eixos são independentes (ADR-031 §6).

**`requireOrganizationAccess` (boundary reutilizável — G3, primeira
montagem real em P1, seção 10 abaixo):** dado um `organizationPublicId`
recebido do frontend, prova
`organizationPublicId ∈ PortalContext(identity)` antes de qualquer
operação comercial — a seleção de contexto pelo frontend **nunca é
autoridade** (ORGANIZATION-MEMBERSHIP-DESIGN.md §6, decisão da Fase G
reafirmada aqui). Falha sempre com `ORGANIZATION_ACCESS_DENIED` — nunca
`404`, mesmo quando a Organization não existe ou não está `ACTIVE`
(esconder essa distinção é deliberado, não uma lacuna).

---

## 10. `/api/v1/portal/organizations/:organizationPublicId/external-references/PCTEC_PORTAL`

**Status: implementado — P1 Portal (v0.7.x).** Primeira rota real do
Ingressa a servir a integração com um sistema legado (`pctec-portal`)
— e a primeira rota a montar de fato `requireOrganizationAccess` (G3,
preparado desde então, nunca usado em rota real até aqui).

**Responsabilidade:** dado um `organizationPublicId` já confirmado
pertencente ao `PortalContext` da Identity chamadora, resolver o
mapeamento legado (`OrganizationExternalReference` `ACTIVE`) para o
sistema `PCTEC_PORTAL`, entidade `clientes` — nunca `clientes_grupo`,
que nunca produz contexto comercial (decisão do piloto AFIP).

**`GET /api/v1/portal/organizations/:organizationPublicId/external-references/PCTEC_PORTAL`**

Pipeline: `requireAuthenticatedSession` → `requireApplicationAccess`
(`PCTEC_PORTAL`, `USER`) → `requireOrganizationAccess` → handler.
`PCTEC_PORTAL` é um segmento **literal** da URL (não um parâmetro) —
qualquer outro valor nesse segmento nunca alcança a autenticação,
resolve como `404` de rota do próprio Express antes disso.

Contrato de resposta:

```json
{
  "organization": { "publicId": "..." },
  "externalReference": { "systemCode": "PCTEC_PORTAL", "entityType": "clientes", "legacyId": 75 }
}
```

Nunca inclui `internalId`/`documentNumber`/`Membership`/`Credential`/
Session token/dado de auditoria/referências de outros sistemas.

**Contrato 401 × 403 × 404:**

| Situação | Código | Classificação | HTTP |
|---|---|---|---|
| Sem sessão | `SESSION_INVALID` | `AUTHENTICATION` | 401 |
| Sessão válida, sem `ApplicationAccess(PCTEC_PORTAL, USER)` | `APPLICATION_ACCESS_DENIED` | `AUTHORIZATION` | 403 |
| Sessão + Portal access válidos, mas `organizationPublicId` fora do `PortalContext` efetivo | `ORGANIZATION_ACCESS_DENIED` | `AUTHORIZATION` | 403 |
| Organization autorizada, mas sem `OrganizationExternalReference` `ACTIVE` para `PCTEC_PORTAL`/`clientes` | `ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND` | `VALIDATION` (override HTTP 404) | 404 |

`404` nunca é usado para esconder falta de autorização — essa já tem
seu `403` próprio, avaliado antes. `404` aqui é genuinamente "recurso
(mapeamento legado) inexistente" para uma Organization já legítima e
autorizada.

---

## 11. `/api/v1/service/portal/identities/:identityPublicId/organizations/:organizationPublicId/external-references/PCTEC_PORTAL`

**Status: implementado — P1A.1 (v0.7.x).** Fronteira **service-to-service**
Ingressa↔Portal, **completamente separada** da fronteira browser-facing
(seção 10) — nunca a mesma rota, nunca o mesmo pipeline, nunca a mesma
prova de identidade. Chamador esperado: o backend do `pctec-portal`
(server-to-server), nunca um browser.

**Motivação (achado real de infraestrutura, P1A.1):** `ingressa_session`
é `HttpOnly` e host-only (sem `Domain` explícito) — o browser nunca
consegue apresentá-lo a um hostname diferente do que o emitiu.
`portal-dev.pctec.com.br` e `ingressa-dev.pctec.com.br` são hostnames
distintos, confirmado por Nginx real — o cookie de sessão nunca chega
ao Portal por design, e a decisão foi não abrir `Domain=.pctec.com.br`
só para compartilhar sessão entre aplicações.

**Autenticação**: header `X-Portal-Service-Credential: <segredo>` —
comparado por digest SHA-256 + `crypto.timingSafeEqual` (nunca `===`
direto no segredo, nunca um segredo funcional por omissão — variável
`INGRESSA_PORTAL_SERVICE_CREDENTIAL` vazia/ausente = rota
**indisponível**, fail-closed absoluto). Header ausente, valor
incorreto, e configuração ausente no servidor produzem **o mesmo**
erro externo — deliberadamente indistinguível.

**`identityPublicId` só é uma entrada confiável aqui porque a chamada
inteira já é service-to-service** — a credencial de máquina prova
"quem está chamando" (o Portal), nunca "em nome de quem"; por isso o
Ingressa **recomputa** `ApplicationAccess`/`PortalContext`/
`OrganizationAccess` a partir do `identityPublicId` recebido, com os
MESMOS services já usados na rota browser-facing
(`AuthorizeApplicationAccessService`, `RequireOrganizationAccessService`),
**nenhum dos dois alterado**. Esta API nunca deve ser chamada com um
`identityPublicId` originado direto do browser sem prova server-side —
essa é responsabilidade do chamador (o Portal), formalizado como
pré-requisito de P1B (ver `ORGANIZATION-MEMBERSHIP-DESIGN.md`).

Contrato de resposta — **ainda mais mínimo que a rota browser-facing**:
```json
{ "legacyId": 75 }
```
Nunca inclui `identityPublicId`, `organizationPublicId`, `Membership`,
CNPJ ou qualquer detalhe da referência além do `legacyId` em si.

**Contrato de erro:**

| Situação | Código | Classificação | HTTP |
|---|---|---|---|
| Credencial ausente, inválida, ou não configurada no servidor | `SERVICE_CREDENTIAL_INVALID` | `AUTHENTICATION` | 401 |
| Identity sem `ApplicationAccess(PCTEC_PORTAL, USER)` | `APPLICATION_ACCESS_DENIED` | `AUTHORIZATION` | 403 |
| Organization fora do `PortalContext` efetivo da Identity | `ORGANIZATION_ACCESS_DENIED` | `AUTHORIZATION` | 403 |
| Organization autorizada, sem `OrganizationExternalReference` `ACTIVE` `clientes` | `ORGANIZATION_EXTERNAL_REFERENCE_NOT_FOUND` | `VALIDATION` (override HTTP 404) | 404 |

## 12. `/api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId`

**Status: implementado — P1B.0 Fatia 4 (v0.7.x).** Fronteira
**service-to-service**, protegida pela mesma infraestrutura de P1A.1
(`requireServiceCredential`, `INGRESSA_PORTAL_SERVICE_CREDENTIAL`) —
sem duplicação de middleware.

**Propósito único: resolver `portal_acesso.id` → `Identity.publicId`.**

O Portal tem `req.user.id` = `portal_acesso.id` (legacyId) e não tem como
saber qual `Identity.publicId` do Ingressa corresponde a esse usuário.
Caso real confirmado: `portal_acesso.id=33` e Identity
`66231e51-66fb-466d-af4f-ac7b925ca9ec` são a mesma pessoa com e-mails
diferentes — matching por e-mail não é suficiente; o vínculo precisa
ter sido cadastrado explicitamente via CLI (Fatia 3).

`PCTEC_PORTAL` e `portal_acesso` são segmentos **literais** da URL, não
parâmetros — a rota não é genérica para qualquer sistema/entidade. Isso
é intencional: outras combinações exigirão novas rotas (decisão deliberada).

**Pipeline**:
```
requireServiceCredential
→ GetActiveIdentityExternalReferenceService
→ { "identityPublicId": "<uuid>" }
```

**Sem `AuthorizeApplicationAccessService` nem `RequireOrganizationAccessService`**:
esses verificam o que uma Identity pode fazer — aqui não há
`identityPublicId` como entrada; estamos justamente resolvendo qual é.
Chamar esses services seria impossível por design.

**Esta rota NÃO concede acesso comercial.** Ela apenas resolve o
mapeamento de identidade. O Portal ainda precisará, na futura P1B,
chamar a rota da seção 11 com o `identityPublicId` resolvido para
verificar `ApplicationAccess` e `OrganizationAccess`.

**`GET /api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId`**

Autenticação: `X-Portal-Service-Credential: <segredo>` — mesma
infraestrutura de P1A.1 (seção 11).

Contrato de resposta — **mínimo**:
```json
{ "identityPublicId": "66231e51-66fb-466d-af4f-ac7b925ca9ec" }
```
Nunca inclui `legacyId`, `matchMethod`, e-mail, nome, CPF, status
interno ou o `publicId` da própria `IdentityExternalReference`.

**Contrato de erro:**

| Situação | Código | Classificação | HTTP |
|---|---|---|---|
| Credencial ausente, inválida, ou não configurada no servidor | `SERVICE_CREDENTIAL_INVALID` | `AUTHENTICATION` | 401 |
| Nenhuma `IdentityExternalReference` `ACTIVE` para esse `legacyId` | `IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND` | `VALIDATION` (override HTTP 404) | 404 |
| `legacyId` inválido (zero, negativo, não numérico) | `LEGACY_ID_INVALID` | `VALIDATION` | 422 |

## Questões pendentes de decisão

- ~~Mecanismo de autenticação serviço a serviço para chamadas de
  consumidores à API do Ingressa.~~ **Resolvido — P1A.1 (v0.7.x)**:
  credencial dedicada (`INGRESSA_PORTAL_SERVICE_CREDENTIAL`), exclusiva
  ao canal Ingressa↔Portal, aceita só na rota da seção 11 acima. Não é
  um mecanismo genérico para qualquer consumidor futuro — decisão
  deliberadamente estreita, reavaliar se outro sistema precisar de algo
  parecido.
- ~~**Gap explícito para P1B (registrado, não resolvido nesta entrega)**:
  como mapear `portal_acesso`/usuário legado do Portal para
  `Identity.publicId` do Ingressa. A rota da seção 11 só é segura
  porque `identityPublicId` chega como prova server-to-server — a
  futura P1B **não pode** aceitar `identityPublicId` vindo do browser
  como autoridade; o Portal precisa determinar, do próprio lado,
  server-side, qual `Identity.publicId` corresponde ao usuário
  autenticado nele. Esse mapeamento (provavelmente via um novo
  `OrganizationExternalReference`-like ou tabela própria — decisão
  ainda não tomada) é o próximo problema real da integração, percebido
  antes de codar qualquer middleware que aceitasse esse valor do
  frontend.~~ **Parcialmente resolvido — P1B.0 (v0.7.x)**: o mecanismo
  de resolução `portal_acesso.id → Identity.publicId` está implementado
  via `IdentityExternalReference` (tabela paralela a
  `organization_external_references`, migration 0016) + CLI de bootstrap
  (`bootstrap-identity-external-reference`, Fatia 3) + rota
  service-to-service (seção 12, Fatia 4). O Portal resolve
  `PCTEC_PORTAL / portal_acesso / legacyId → Identity.publicId` via
  `GET /api/v1/service/portal/identity-external-references/PCTEC_PORTAL/portal_acesso/:legacyId`
  antes de qualquer chamada à seção 11. `identityPublicId` **nunca**
  vem do browser.

  **Ainda pendente para P1B:** como o Portal determina/seleciona
  `organizationPublicId` de forma confiável, sem depender de autoridade
  fornecida pelo browser. O mecanismo de identidade está resolvido;
  o mecanismo de seleção de organização agora também está resolvido via
  seção 13 abaixo — o Portal chama a nova rota para obter a lista de
  Organizations autorizadas, elimina a necessidade de `organizationPublicId`
  vindo do browser.
- Valor padrão e máximo de `limit` na paginação.
- Onde e como o `refresh_token` é efetivamente entregue ao cliente.
  **Atualizado (v0.6.0 — ADR-030):** `RefreshToken` foi avaliado e
  **deferido** para uma fase futura, fora do escopo da Fase D (primeiro
  login real) — a Fase D usa sessão opaca com expiração absoluta, sem
  renovação silenciosa. Esta questão permanece pendente apenas para
  quando `RefreshToken` for de fato implementado.
- Necessidade de endpoint de introspecção de sessão dedicado para
  consumidores (`/api/v1/sessions/introspect` ou equivalente) — não incluído
  nesta versão conceitual por falta de decisão prévia.

## 13. `/api/v1/service/portal/identities/:identityPublicId/context`

**Status: implementado — P1B.1 (v0.7.x).** Fronteira **service-to-service**,
protegida por `X-Portal-Service-Credential` — mesmo namespace e mesmo
`requireServiceCredential` de P1A.1, P1B.0 Fatia 4. Sem duplicação de middleware.

**Propósito:** dado um `identityPublicId` já resolvido server-side pelo Portal
(via Fatia 4: `portal_acesso.id → Identity.publicId`), retornar as Organizations
que essa Identity pode acessar no Portal. Elimina a necessidade de o frontend
fornecer `organizationPublicId`.

**Pipeline (equivalente service-to-service de `GET /api/v1/portal/context`):**

```
requireServiceCredential
→ AuthorizeApplicationAccessService({ identityPublicId, PCTEC_PORTAL, USER })
→ GetPortalContextService(identityPublicId)
→ { "organizations": [...] }
```

**Por que `AuthorizeApplicationAccessService` é obrigatório:** `IdentityExternalReference`
prova apenas o vínculo `portal_acesso.id ↔ Identity` — não prova que a Identity ainda
tem `ApplicationAccess(PCTEC_PORTAL, USER)`. Esses eixos são independentes (ADR-031 §6).

**`GET /api/v1/service/portal/identities/:identityPublicId/context`**

Autenticação: `X-Portal-Service-Credential: <segredo>`.

Contrato de resposta:
```json
{
  "organizations": [
    { "publicId": "...", "type": "BUSINESS_GROUP", "legalName": "AFIP", "tradeName": "AFIP" },
    { "publicId": "...", "type": "COMPANY", "legalName": "...", "tradeName": "AFIP - BOSQUE" }
  ]
}
```

Nunca retorna: `identityPublicId`, `membershipPublicId`, `profile`, `scope`,
`cliente_id`, `legacyId`, ids internos, service credential.

`GetPortalContextService` já implementa Membership ACTIVE + expansão
`ORGANIZATION_AND_DESCENDANTS` + deduplicação. O Portal **não reimplementa** nenhuma dessas regras.

**Contrato de erro:**

| Situação | Código | HTTP |
|---|---|---|
| Credencial ausente/inválida/não configurada | `SERVICE_CREDENTIAL_INVALID` | 401 |
| Identity sem `ApplicationAccess(PCTEC_PORTAL, USER)` | `APPLICATION_ACCESS_DENIED` | 403 |
