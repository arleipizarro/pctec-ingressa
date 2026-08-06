# ADR-025 — Perfis relacionais (EMPLOYEE, CUSTOMER, PARTNER, SUPPLIER) pertencem ao Membership, não à Identity

## Contexto

O ADR-013 (v0.2.0) havia proposto, como decisão pendente de confirmação,
que `Membership` e `ApplicationAccess` referenciassem `IdentityProfile` —
um perfil supostamente global da `Identity` (`EMPLOYEE`, `CUSTOMER`,
`PARTNER`, `SUPPLIER`). A especificação de domínio do núcleo Identity
(v0.3.0) chegou a detalhar `IdentityProfile` como entidade associada ao
Aggregate Root `Identity`, com comandos (`AddIdentityProfile`,
`RemoveIdentityProfile`), eventos (`identity.profile-added`,
`identity.profile-removed`) e erros próprios.

Na revisão desta entrega, o Product Owner e o Platform Architect
identificaram que essa modelagem está incorreta: `EMPLOYEE`, `CUSTOMER`,
`PARTNER` e `SUPPLIER` não são características intrínsecas de uma
`Identity` — são classificações que dependem da relação entre a `Identity`
e uma `Organization` específica. A mesma `Identity` pode ser `EMPLOYEE` na
Organização A, `CUSTOMER` na Organização B e `PARTNER` na Organização C,
simultaneamente. Modelar isso como um perfil global da `Identity` (sem
vínculo com organização) não representa esse cenário corretamente e mistura
uma classificação relacional dentro do agregado errado.

Esta decisão corrige a abstração antes de qualquer implementação — nenhum
dado, tabela, SQL ou código foi criado com base na modelagem anterior, logo
não há migração de dados a considerar.

## Decisão

1. `Identity` representa exclusivamente quem a entidade é — não carrega
   nenhuma classificação relacional a organizações.
2. `Membership` representa o vínculo entre `Identity` e `Organization`, e é
   o lugar correto para expressar classificações como `EMPLOYEE`,
   `CUSTOMER`, `PARTNER` e `SUPPLIER`.
3. Os perfis anteriormente chamados `IdentityProfile` passam a pertencer
   conceitualmente ao contexto do `Membership`, sob o nome provisório
   `MembershipProfile` — modelagem definitiva a ser detalhada em revisão
   futura do bounded context `organization`/`access`, fora do escopo desta
   entrega.
4. `Identity.type` permanece `HUMAN` no MVP (ADR-018), sem relação com esta
   correção — `type` (natureza da entidade) e classificação relacional
   organizacional são conceitos independentes.
5. Não há `IdentityProfile` como entidade filha do Aggregate Root
   `Identity`. O agregado `Identity` não possui nenhuma entidade associada
   nesta entrega além de si mesmo.
6. Os comandos `AddIdentityProfile` e `RemoveIdentityProfile` não
   pertencem ao domínio `identity`. Comandos equivalentes, se necessários,
   pertencerão ao domínio `organization`/`access`, operando sobre
   `Membership`.
7. Os eventos `identity.profile-added` e `identity.profile-removed` não
   pertencem ao catálogo do domínio `identity`.
8. Os erros `IDENTITY_PROFILE_ALREADY_EXISTS` e
   `IDENTITY_PROFILE_NOT_FOUND` não pertencem ao domínio `identity`.
9. `ApplicationAccess` não deve referenciar `IdentityProfile` — referencia
   `Identity` diretamente (por `public_id`/`id` interno, conforme já
   convencionado). Se uma concessão de acesso precisar ser sensível a
   contexto organizacional/perfil relacional, isso será modelado via
   `MembershipProfile` na revisão do bounded context
   `organization`/`access`, não reintroduzindo `IdentityProfile`.
10. A modelagem definitiva de `MembershipProfile` — atributos, invariantes,
    comandos, eventos, e sua relação com `ApplicationAccess` — será
    detalhada em entrega própria do bounded context `organization`/`access`.
    Esta entrega não a implementa, nem propõe tabela, SQL ou código para
    ela.

## Consequências

- `docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md` é atualizado para remover
  `IdentityProfile` como entidade associada, os comandos
  `AddIdentityProfile`/`RemoveIdentityProfile`, os eventos
  `identity.profile-added`/`identity.profile-removed`, e os erros
  `IDENTITY_PROFILE_ALREADY_EXISTS`/`IDENTITY_PROFILE_NOT_FOUND` — todos
  fora do escopo do domínio `identity`.
- `docs/03-dominio/IDENTITY-UBIQUITOUS-LANGUAGE.md` é atualizado: o termo
  `Identity Profile` deixa de ser um conceito do bounded context
  `identity`; é adicionada nota indicando que `EMPLOYEE`, `CUSTOMER`,
  `PARTNER` e `SUPPLIER` são classificações relacionais do `Membership`,
  sem definir ainda o desenho definitivo de `MembershipProfile`.
- `docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md`,
  `docs/03-dominio/MODELO-DE-DOMINIO.md`,
  `docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md`,
  `docs/02-arquitetura/CATALOGO-DE-EVENTOS.md` e
  `docs/02-arquitetura/SOFTWARE-ARCHITECTURE-BLUEPRINT.md` são atualizados
  para refletir esta correção, mantendo coerência entre todos os
  documentos.
- ADR-013 (v0.2.0) é atualizado para registrar que sua pendência foi
  resolvida por esta decisão.
- Nenhuma tabela, SQL, migration ou código é criado para `MembershipProfile`
  nesta entrega — permanece **Pendente de decisão** de modelagem, a ser
  tratada em entrega própria do bounded context `organization`/`access`.
- Esta correção não envolve migração de dados: nenhuma implementação
  baseada na modelagem anterior (`IdentityProfile` como filho de
  `Identity`) chegou a ser criada como código, banco ou API.

## Status

Aprovado pelo Product Owner e pelo Platform Architect — v0.3.0 Identity
Core (documental). Corrige a pendência registrada em ADR-013.
