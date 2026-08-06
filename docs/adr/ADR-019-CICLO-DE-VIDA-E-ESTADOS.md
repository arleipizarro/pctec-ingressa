# ADR-019 — Ciclo de vida e estados de Identity

## Contexto

O modelo de domínio da v0.2.0 (`MODELO-DE-DOMINIO.md`) definiu quatro
estados conceituais para `Identity`: `PENDING`, `ACTIVE`, `BLOCKED`,
`INACTIVE`. A especificação detalhada do núcleo Identity (v0.3.0) exige um
estado adicional para representar exclusão lógica de forma explícita no
próprio ciclo de vida, em vez de tratá-la apenas como um caso de
`INACTIVE`.

## Decisão

O ciclo de vida de `Identity` passa a prever cinco estados:

- `PENDING`
- `ACTIVE`
- `BLOCKED`
- `INACTIVE`
- `DELETED`

`DELETED` representa exclusão lógica e é estado terminal: nenhuma
transição operacional comum sai de `DELETED`. `login_enabled` é sempre
`false` quando `status = DELETED`.

A tabela completa de transições permitidas está documentada em
`IDENTITY-DOMAIN-DESIGN.md`, seção "Estados e transições". Esta decisão
formaliza apenas a existência do estado adicional e sua natureza terminal;
não define ainda quem pode acionar cada transição em termos de papel
administrativo específico (isso permanece **Pendente de decisão**, fora do
escopo desta entrega).

## Consequências

- `docs/03-dominio/MODELO-DE-DOMINIO.md` é atualizado para incluir
  `DELETED` no enum de status de `Identity`, mantendo compatibilidade com
  os quatro estados já existentes.
- `docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md` é atualizado para
  refletir o novo valor de `ENUM` na tabela `identities`.
- Qualquer implementação futura de máquina de estados deve tratar
  `DELETED` como terminal, sem caminho de "desfazer" pelo fluxo comum.

## Status

Proposto — v0.3.0 Identity Core (documental).
