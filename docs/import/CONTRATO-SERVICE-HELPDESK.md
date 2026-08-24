# Contrato service-to-service do Helpdesk — a definir na próxima fatia

Status: **contrato registrado, não implementado** (v0.8.x, fundação).

## Credencial própria

`INGRESSA_HELPDESK_SERVICE_CREDENTIAL`, distinta e independente de
`INGRESSA_PORTAL_SERVICE_CREDENTIAL`.

**Nunca reutilizar a credencial do Portal.** Uma credencial compartilhada
significa que vazar a do Helpdesk dá acesso ao contexto do Portal, e que
revogar uma derruba os dois produtos. Mesmo princípio de ADR-031 §1 já
aplicado às Applications: cada consumidor com identidade própria.

## Rota preferida

```
GET /api/v1/service/helpdesk/users/:legacyUserId/context
Header: X-Service-Credential: <INGRESSA_HELPDESK_SERVICE_CREDENTIAL>
```

### Resolução interna

A rota recebe **`users.id` do Helpdesk** e resolve a Identity ela mesma,
via `IdentityExternalReference(PCTEC_HELPDESK, 'users', legacyUserId)`.

**Não aceita `identityPublicId` vindo do chamador.** Se aceitasse, o
Helpdesk poderia — por bug ou por requisição forjada — pedir o contexto
de qualquer pessoa. A mesma decisão já foi tomada na rota equivalente do
Portal, e pelo mesmo motivo.

### Pipeline

```
credencial de serviço válida
  → users.id → IdentityExternalReference(PCTEC_HELPDESK,'users',id) → identityPublicId
  → AuthorizeApplicationAccessService(identityPublicId, PCTEC_HELPDESK, USER)
  → Memberships ativas → Organizations
  → { organizations: [{ publicId, type, legalName, tradeName }] }
```

### Respostas

| situação | resposta |
|---|---|
| credencial ausente/inválida | `401` |
| sem `ApplicationAccess(PCTEC_HELPDESK)` | `403` |
| sem membership | `403` — nunca `200` com lista vazia |
| referência externa inexistente | `404` |
| ok | `200` com as organizations autorizadas |

Cliente sem membership recebe **403**, não uma lista vazia: lista vazia é
ambígua entre "não tem acesso" e "tem acesso a nada", e o consumidor
tende a tratar a segunda como benigna.

## Sem expansão por `client_group_id`

A auditoria do código do Helpdesk provou que `client_group_id` **não
concede acesso a nenhuma outra empresa do grupo**:

- só um leitor em todo o backend (`/api/client-groups/my-clients`);
- todo filtro de leitura usa `client_id` sozinho (`tickets.js:129`,
  `:530`, `:743`, `:1330`);
- `tickets.js:932` **descarta** a empresa escolhida pelo usuário e força
  `req.user.client_id`;
- um usuário com grupo e sem `client_id` não consegue nem abrir chamado.

O contexto devolvido por esta rota reflete exatamente isso: as
organizations vêm das Memberships que existem, e **nenhuma expansão de
grupo é feita aqui**. `ORGANIZATION_AND_DESCENDANTS` só aparece se
alguém tiver recebido esse escopo por **concessão manual aprovada** —
nunca por dedução do importador.

## Consumidor único

O backend do Helpdesk. Nunca o browser, nunca outro produto. A credencial
vive no servidor do Helpdesk e não transita para o cliente.

## O que NÃO entra nesta rota

- `tenant-scope`: sem `AND_DESCENDANTS` a resolver, não tem função nesta
  fase.
- Reaproveitamento de qualquer rota `/service/portal/*`: `PCTEC_PORTAL` e
  `portal_acesso` são segmentos **literais** de path lá, e o próprio
  código diz que aquelas rotas servem só ao Portal.
