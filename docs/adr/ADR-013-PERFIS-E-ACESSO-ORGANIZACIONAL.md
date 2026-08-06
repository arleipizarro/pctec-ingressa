# ADR-013 — Perfis como contexto de vínculo organizacional e de acesso

## Contexto

ADR-002 já estabeleceu que uma identidade pode ter múltiplos perfis
(`EMPLOYEE`, `CUSTOMER`, `PARTNER`, `SUPPLIER`, futuramente
`SERVICE_ACCOUNT`). Falta decidir como esses perfis se relacionam com os
vínculos organizacionais (`Membership`) e com a concessão de acesso a
aplicações (`ApplicationAccess`) — ou seja, se o vínculo e o acesso são
por identidade "genérica" ou contextualizados a um perfil específico.

## Decisão

Um `Membership` e um `ApplicationAccess` são propostos como
contextualizados a um `IdentityProfile` específico, não apenas à
`Identity` de forma genérica. Isso permite, por exemplo, que a mesma pessoa
tenha um vínculo como `EMPLOYEE` de uma empresa e, separadamente, um vínculo
como `CUSTOMER` de outra, sem que os dois contextos se confundam.

Esta decisão é registrada como proposta desta entrega e marcada como
**Pendente de confirmação** com o Platform Architect antes da
implementação, dado seu impacto direto no modelo relacional
(`identity_profile_id` em `memberships` e `application_access`).

## Consequências

- O modelo de domínio e o modelo relacional propostos nesta entrega já
  assumem esta contextualização.
- Caso a decisão final seja pela abordagem perfil-agnóstica, os documentos
  `MODELO-DE-DOMINIO.md` e `MODELO-RELACIONAL-PROPOSTO.md` precisarão ser
  ajustados antes da implementação.
- Em nenhuma hipótese esta decisão introduz permissões finas de negócio no
  Ingressa — ela trata apenas do contexto do vínculo, não de autorização
  operacional.

## Status

Proposto, com item explicitamente pendente de confirmação — v0.2.0 Domain
Foundation.
