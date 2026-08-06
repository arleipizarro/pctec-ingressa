# ADR-014 — Módulos internos organizados por bounded context

## Contexto

O domínio do Ingressa reúne responsabilidades distintas (identidade,
organização, catálogo de aplicações, concessão de acesso, mecânica de
autenticação, auditoria). Sem uma divisão interna clara, essas
responsabilidades tendem a se misturar dentro de um único módulo, dificultando
manutenção e violando os limites definidos na Constituição da Plataforma.

## Decisão

O código e o domínio do Ingressa são organizados em seis bounded contexts:

- `identity` — Identity, IdentityProfile.
- `organization` — Organization, OrganizationRelationship, Membership.
- `application` — Application (catálogo).
- `access` — ApplicationAccess.
- `security` — Credential, MagicLink, Session, RefreshToken.
- `audit` — AuditEvent.

Cada bounded context é responsável exclusivamente pelas entidades listadas
acima e não deve conter lógica de negócio de outro contexto. Comunicação
entre contextos ocorre por chamadas internas explícitas ou por eventos de
domínio, nunca por acesso direto a tabelas de outro contexto sem passar
pela camada de domínio correspondente.

## Consequências

- Facilita a evolução independente de cada contexto (por exemplo, trocar o
  mecanismo de sessão sem afetar o cadastro de identidades).
- Reforça a fronteira entre autorização global (`access`) e o restante do
  domínio.
- Não define, nesta fase, se os bounded contexts serão módulos dentro de um
  único serviço ou serviços fisicamente separados — essa é uma decisão de
  implementação futura, Pendente de decisão.

## Status

Proposto — v0.2.0 Domain Foundation.
