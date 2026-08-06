# ADR-024 — Controle de concorrência por optimistic locking (version)

## Contexto

`Identity` pode ser atualizada por diferentes atores (administração,
autoatendimento, processos automatizados de reconciliação). Sem controle de
concorrência, atualizações concorrentes podem sobrescrever mudanças umas
das outras silenciosamente (lost update).

## Decisão

`Identity` possui um atributo `version`, incrementado a cada alteração de
estado persistida. Toda operação de escrita que altera `Identity` deve
informar a versão esperada; se a versão atual divergir da informada, a
operação é rejeitada com o erro de domínio `IDENTITY_VERSION_CONFLICT`, sem
aplicar a alteração.

Este é um mecanismo de **optimistic locking** conceitual: não há
dependência de nenhum framework ou biblioteca específica, e nenhum SQL de
implementação (trigger, stored procedure) é criado nesta fase.

## Consequências

- Todo comando de domínio que altera `Identity` (ver
  `IDENTITY-DOMAIN-DESIGN.md`, seção "Comandos de domínio") deve declarar a
  versão esperada como parte de sua entrada conceitual, quando aplicável.
- Operações puramente idempotentes (ex.: `EnableLogin` repetido sobre uma
  identidade já com `login_enabled = true`) podem ser desenhadas para não
  falhar por conflito de versão quando o estado final resultante já é o
  desejado — o tratamento exato de idempotência versus conflito de versão
  para cada comando está detalhado no documento principal.
- Biblioteca ou mecanismo concreto de implementação do controle de versão
  (ex.: coluna `version` com `ON UPDATE`, campo gerenciado pela camada de
  aplicação) permanece **Pendente de decisão** de implementação.

## Status

Proposto — v0.3.0 Identity Core (documental).
