# ADR-011 — Identidade pode existir sem estar habilitada para login

## Contexto

Existem cenários em que uma pessoa precisa existir no Cadastro Mestre de
identidades (por exemplo, para vínculo organizacional ou referência em
outro produto) sem que, no mesmo momento, deva ter acesso de login a
qualquer sistema.

## Decisão

`login_enabled` é um atributo independente de `status` em `Identity`. Uma
identidade pode estar `ACTIVE` e ainda assim ter `login_enabled = false`.
Login só é possível quando `status = ACTIVE` **e** `login_enabled = true`.

## Consequências

- A criação de uma identidade não implica automaticamente a capacidade de
  autenticação.
- Habilitar login é uma ação explícita e auditável
  (`identity.login-enabled`).
- Produtos consumidores não devem assumir que toda identidade existente é
  necessariamente uma identidade com login possível.

## Status

Proposto — v0.2.0 Domain Foundation.
