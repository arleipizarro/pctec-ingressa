# ADR-013 — Perfis como contexto de vínculo organizacional e de acesso

## Nota de resolução (v0.3.0 — Identity Core, ADR-025)

**Status da pendência: resolvida.** A pendência de confirmação registrada
abaixo (se o vínculo é contextualizado por `IdentityProfile` ou é
perfil-agnóstico) foi decidida pelo Product Owner e pelo Platform Architect
em ADR-025: **`Identity` não possui perfil organizacional global.** Os
perfis `EMPLOYEE`, `CUSTOMER`, `PARTNER` e `SUPPLIER` pertencem ao contexto
do `Membership`, não da `Identity`.

Resultado prático:

- `Membership` referencia `Identity` diretamente (por `public_id`/`id`
  interno), não `IdentityProfile` — pois `IdentityProfile` deixou de
  existir como entidade do domínio `identity` (ADR-025).
- Nenhum vínculo organizacional ou de acesso depende de `IdentityProfile`.
- A classificação relacional (o que antes seria "perfil") passa a ser
  modelada como `MembershipProfile`, associada ao próprio `Membership` —
  detalhamento definitivo (atributos, invariantes, comandos, eventos)
  fica para entrega própria do bounded context `organization`/`access`,
  fora do escopo desta entrega.
- `ApplicationAccess` também não referencia `IdentityProfile` — referencia
  `Identity` diretamente.

O contexto e a decisão original abaixo permanecem preservados para registro
histórico de como a questão evoluiu; a decisão vigente é a do ADR-025.

## Contexto (histórico — v0.2.0)

ADR-002 já estabeleceu que uma identidade pode ter múltiplos perfis
(`EMPLOYEE`, `CUSTOMER`, `PARTNER`, `SUPPLIER`, futuramente
`SERVICE_ACCOUNT`). Falta decidir como esses perfis se relacionam com os
vínculos organizacionais (`Membership`) e com a concessão de acesso a
aplicações (`ApplicationAccess`) — ou seja, se o vínculo e o acesso são
por identidade "genérica" ou contextualizados a um perfil específico.

## Decisão (histórico — v0.2.0, substituída por ADR-025)

Um `Membership` e um `ApplicationAccess` são propostos como
contextualizados a um `IdentityProfile` específico, não apenas à
`Identity` de forma genérica. Isso permite, por exemplo, que a mesma pessoa
tenha um vínculo como `EMPLOYEE` de uma empresa e, separadamente, um vínculo
como `CUSTOMER` de outra, sem que os dois contextos se confundam.

Esta decisão é registrada como proposta desta entrega e marcada como
**Pendente de confirmação** com o Platform Architect antes da
implementação, dado seu impacto direto no modelo relacional
(`identity_profile_id` em `memberships` e `application_access`).

## Consequências (histórico — v0.2.0)

- O modelo de domínio e o modelo relacional propostos nesta entrega já
  assumem esta contextualização.
- Caso a decisão final seja pela abordagem perfil-agnóstica, os documentos
  `MODELO-DE-DOMINIO.md` e `MODELO-RELACIONAL-PROPOSTO.md` precisarão ser
  ajustados antes da implementação.
- Em nenhuma hipótese esta decisão introduz permissões finas de negócio no
  Ingressa — ela trata apenas do contexto do vínculo, não de autorização
  operacional.

## Status

**Resolvida** por ADR-025 (v0.3.0 — Identity Core). A decisão histórica
acima (perfil-contextualizado via `IdentityProfile`) não é mais vigente;
substituída pela classificação relacional via `Membership`/
`MembershipProfile`.
