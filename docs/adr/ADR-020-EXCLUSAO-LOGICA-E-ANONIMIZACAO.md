# ADR-020 — Exclusão lógica e anonimização controlada

## Contexto

Regulações de proteção de dados podem exigir a eliminação de dados
pessoais de uma identidade. Ao mesmo tempo, o domínio do Ingressa depende
de preservar histórico para auditoria (`AuditEvent`) e para integridade
referencial de `Membership`, `ApplicationAccess` e demais vínculos. Excluir
fisicamente uma `Identity` quebraria essas referências e o rastro de
auditoria.

## Decisão

`Identity` nunca é removida fisicamente pelo fluxo operacional comum.
Exclusão é sempre lógica, representada pela transição de `status` para
`DELETED`, com os seguintes atributos conceituais preenchidos no momento da
exclusão:

- `deleted_at`;
- `deleted_by_identity_public_id` (actor responsável — ver Aggregate Root
  em `IDENTITY-DOMAIN-DESIGN.md`);
- `deletion_reason` (Value Object `DeletionReason`, categórico, não texto
  livre com dados sensíveis).

Pedidos legais de eliminação efetiva de dados pessoais (ex.: direito ao
esquecimento) não são atendidos pela exclusão lógica comum. Eles exigem um
procedimento controlado de **anonimização**, distinto e mais restrito,
representado pelo comando `AnonymizeIdentity` e pelo evento
`identity.anonymized`. Anonimização substitui os dados pessoais
identificáveis (nome, e-mail, CPF) por valores não reversíveis, preservando
apenas o `public_id` e o histórico estrutural necessário para integridade
referencial e auditoria.

Esta decisão não promete retenção eterna de dados pessoais nem define a
política de retenção — isso permanece **Pendente de decisão**, a ser
tratado por uma política de privacidade e retenção específica, fora do
escopo desta entrega.

## Consequências

- Nenhum comando de domínio desta entrega executa `DELETE` físico sobre
  `Identity`.
- `AnonymizeIdentity` é um comando distinto de `LogicallyDeleteIdentity` —
  uma identidade pode estar `DELETED` sem estar anonimizada, e a
  anonimização, quando ocorrer, é registrada como evento próprio
  (`identity.anonymized`), separado de `identity.deleted`.
- Implementações futuras de expurgo de dados (se exigido por lei) devem ser
  tratadas como um processo controlado adicional, não como consequência
  automática de `DELETED`.

## Status

Proposto — v0.3.0 Identity Core (documental).
