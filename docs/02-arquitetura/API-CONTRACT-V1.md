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

Erros esperados: `AUTHENTICATION_FAILED`, `SESSION_NOT_FOUND`.

**Nota de correção (v0.6.0 — ADR-030):** esta seção originalmente listava
`INVALID_CREDENTIALS`, `IDENTITY_LOGIN_DISABLED`, `IDENTITY_BLOCKED`,
`SESSION_NOT_FOUND` como erros externos distintos. Corrigido: os três
primeiros colapsam em um único `AUTHENTICATION_FAILED` (401) — expor
causas de falha de login separadamente permite enumeração de e-mails
cadastrados e inferência do estado administrativo de uma conta. Ver
ADR-030, seção "Conflitos reais encontrados" e "Proteção contra
enumeração", para a justificativa completa. `SESSION_NOT_FOUND`
permanece — usado num contexto diferente (validação de sessão já
estabelecida em requisições subsequentes, não no login em si), onde
distinguir causas não vaza informação sobre outras contas.

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

## Questões pendentes de decisão

- Mecanismo de autenticação serviço a serviço para chamadas de consumidores
  à API do Ingressa.
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
