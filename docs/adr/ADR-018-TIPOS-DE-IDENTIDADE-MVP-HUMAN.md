# ADR-018 — Tipos de identidade e MVP restrito a HUMAN

## Contexto

O ecossistema PCTEC eventualmente precisará reconhecer não apenas pessoas,
mas contas de serviço, aplicações, dispositivos e agentes automatizados
como entidades identificáveis. Modelar `Identity` apenas para pessoas desde
o início criaria retrabalho estrutural quando esses outros tipos surgirem;
modelar todos os tipos agora, sem necessidade imediata, ampliaria o escopo
do MVP sem valor comprovado.

## Decisão

`Identity` prevê, como Value Object `IdentityType`, os seguintes valores:

- `HUMAN`
- `SERVICE`
- `APPLICATION`
- `DEVICE`
- `AGENT`

Apenas `HUMAN` é implementado no primeiro escopo funcional (v0.3.0 em
diante). Os demais tipos permanecem reservados no enum, sem comportamento
implementado, sem regras de negócio associadas, e sem uso permitido em
nenhuma operação além da simples reserva de nome.

Qualquer tentativa de criar uma `Identity` com tipo diferente de `HUMAN` no
MVP deve ser rejeitada com erro de domínio explícito
(`IDENTITY_TYPE_NOT_SUPPORTED`).

## Consequências

- O enum `IdentityType` não precisa ser alterado quando `SERVICE`,
  `APPLICATION`, `DEVICE` ou `AGENT` forem implementados — apenas o
  comportamento associado a cada tipo será adicionado.
- Nenhuma regra de negócio desta entrega assume implicitamente que toda
  `Identity` é uma pessoa; a linguagem ubíqua e os comandos tratam `type`
  como atributo explícito, não implícito.
- A implementação de tipos não-humanos permanece **Pendente de decisão**
  quanto a prazo, requisitos específicos e se cada tipo terá atributos
  adicionais próprios (fora do escopo desta entrega).

## Status

Proposto — v0.3.0 Identity Core (documental).
