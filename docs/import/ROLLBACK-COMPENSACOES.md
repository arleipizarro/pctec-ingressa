# Rollback do importador — compensações, nunca DELETE

Status: **desenho registrado, não implementado** (v0.8.x, fundação).

## Princípio

O rollback de um lote de importação **não apaga linhas**. Ele aplica
**compensações**: leva cada entidade escrita a um estado inativo,
preservando a trilha de que ela existiu e de qual lote a criou.

A razão é a mesma que fez `organization_external_references` e
`identity_external_references` marcarem `SUPERSEDED` em vez de deletar:
um `DELETE` apaga a explicação junto com o dado. Depois dele, ninguém
consegue responder "por que esta pessoa teve acesso entre a terça e a
quinta?".

Há também uma razão dura: `ON DELETE RESTRICT` está em todas as FKs do
Ingressa. Um `DELETE` indiscriminado nem roda — ele falha no meio,
deixando o lote parcialmente revertido, que é o pior dos estados.

## Compensação por entidade

| entidade | compensação | resultado |
|---|---|---|
| `ApplicationAccess` | **REVOKE** — `status = REVOKED`, `revoked_at`, `revoked_by` | acesso cessa; `active_grant_key` vira NULL e libera nova concessão futura |
| `Membership` | **END** — `status = INACTIVE`, `ended_at` | contexto some do `tenant-scope`; histórico permanece |
| `IdentityExternalReference` | **END** — `status = SUPERSEDED` | `active_match_key` vira NULL; o vínculo legado deixa de resolver |
| `OrganizationExternalReference` | **END** — `status = SUPERSEDED` | idem |
| `Identity` criada pelo lote | **INACTIVE** — `status = INACTIVE`, `login_enabled = 0` | a pessoa não autentica nem aparece; nada é apagado |
| `Organization` criada pelo lote | **INACTIVE**, e **somente** se não houver dependência | ver abaixo |

## Ordem

Inversa à da escrita, para que nenhuma compensação deixe uma referência
pendurada:

```
ApplicationAccess  →  Membership  →  IdentityExternalReference
→  Identity  →  OrganizationExternalReference  →  Organization
```

## Organization: a exceção com trava

Uma `Organization` só é inativada se **nenhuma** destas existir apontando
para ela: `Membership` ativa, `OrganizationRelationship`,
`OrganizationExternalReference` ativa de OUTRO sistema.

O terceiro caso é o que importa na prática. Na primeira fatia AFIP, as
organizações **já existem** e vieram do `PCTEC_PORTAL` — o lote do
Helpdesk só acrescenta uma referência própria a elas. Inativar a
organização no rollback derrubaria o Portal, que não tem nada a ver com
o lote. Por isso a fatia AFIP não cria nenhuma Organization: não há o que
compensar aí.

## O que NUNCA participa do rollback de dados

- **A Application `PCTEC_HELPDESK`** (migration 0018). É configuração de
  plataforma, não dado de lote: não pertence a `import_batch` nenhum.
- **As migrations estruturais** (0017, 0019, 0020, 0021). Reverter schema
  é operação separada, deliberada, com seu próprio `down`.

## Registro

Cada compensação gera seu próprio `import_batch` de modo `APPLY`,
referenciando o lote compensado. O rollback é uma execução auditável como
qualquer outra — não uma operação fora da trilha.
