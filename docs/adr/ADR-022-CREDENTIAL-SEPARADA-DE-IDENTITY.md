# ADR-022 — Credential separada de Identity

## Contexto

O ADR-017 já estabeleceu que `Identity` não é a raiz de segurança da
plataforma. Esta decisão formaliza especificamente a separação entre
`Identity` e `Credential`, detalhando o que isso significa para os
atributos do agregado.

## Decisão

`Identity` não conhece senha nem qualquer segredo de autenticação
diretamente. Os seguintes atributos **nunca** existem em `Identity`:

- `password`;
- `password_hash`;
- `password_salt`;
- qualquer outro segredo de autenticação.

`Credential` é uma entidade própria do bounded context `security`
(conforme ADR-014), que referencia `Identity` por `public_id`, mas possui
ciclo de vida, tabela e agregado independentes. `Identity` pode ser criada,
consultada e ter seu diretório atualizado sem que nenhuma `Credential`
exista ainda para ela (ex.: colaborador pré-cadastrado sem login
habilitado).

## Consequências

- Nenhum comando de domínio de `Identity` (`CreateIdentity`,
  `UpdateIdentityName`, etc.) recebe ou manipula senha.
- A criação da primeira `Credential` é sempre consequência de um fluxo de
  `MagicLink` do tipo `ACTIVATION` consumido com sucesso (ver ADR-012),
  nunca um atributo definido na criação da `Identity`.
- Algoritmo de hash de senha, biblioteca de autenticação e formato de
  armazenamento de `Credential` permanecem **Pendente de decisão**, fora do
  escopo desta entrega.

## Status

Proposto — v0.3.0 Identity Core (documental).
