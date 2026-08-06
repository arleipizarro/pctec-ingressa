# ADR-015 — Estratégia de migração de impacto zero

## Contexto

O primeiro consumidor do Ingressa (PCTEC Portal) já possui uma base de
usuários ativa. Qualquer migração de provedor de identidade sem estratégia
formal de rollback e validação gradual arrisca indisponibilidade e perda de
acesso para usuários reais.

## Decisão

Toda adoção do Ingressa por um produto consumidor segue obrigatoriamente as
etapas: construção isolada, espelhamento, reconciliação, feature flag,
piloto, dual validation, corte, rollback disponível em qualquer etapa até a
consolidação, e desativação gradual do legado — detalhadas em
`docs/06-governanca/ESTRATEGIA-DE-MIGRACAO-IMPACTO-ZERO.md`.

Nenhum corte definitivo para um produto consumidor ocorre sem rollback
testado e sem aprovação explícita do Product Owner.

## Consequências

- Toda proposta de integração de um novo consumidor deve referenciar esta
  estratégia e declarar em qual etapa se encontra.
- Desativação do legado é sempre decisão por produto consumidor, nunca uma
  decisão simultânea para todo o ecossistema.
- Esta decisão não define prazos específicos — prazos são Pendente de
  decisão, definidos caso a caso.

## Status

Proposto — v0.2.0 Domain Foundation.
