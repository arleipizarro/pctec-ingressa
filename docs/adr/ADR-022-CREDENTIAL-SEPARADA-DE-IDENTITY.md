# ADR-022 — Credential separada de Identity

## Nota de correção (v0.5.x — ADR-029, Fase C da ADR-027)

A frase "a criação da primeira `Credential` é sempre consequência de um
fluxo de `MagicLink`... nunca um bootstrap" (Decisão original, abaixo)
permanece válida como **regra geral** para toda `Credential` criada após
a primeira. A **primeira** `Credential` da plataforma é uma **exceção de
bootstrap formalizada em ADR-029** — mesmo padrão já aplicado à Identity
fundacional (ADR-027) e à primeira concessão administrativa (ADR-028):
um CLI local, one-shot, auditável (`actor_public_id = "BOOTSTRAP"`), pela
mesma razão estrutural (dependência circular — `MagicLink` depende de
infraestrutura de `security` que ainda não existe). Ver ADR-029, seção
"Conflito real encontrado — resolvido nesta ADR", para a justificativa
completa.

**Escopo exato da exceção (revisão crítica, ADR-029):** o guard que
protege esse bootstrap é **global** — "já existe alguma `Credential
LOCAL_PASSWORD` no sistema, de qualquer identidade?" — não vinculado a
uma `Identity` específica (nem hardcoded). Depois da primeira credencial
criada por qualquer identidade, o bootstrap fica permanentemente
inutilizável para qualquer identidade futura. **Esta ADR (ADR-022)
continua sendo a regra normal para todo usuário futuro** — a exceção
não a revoga, apenas cobre o momento estrutural em que nenhuma
infraestrutura de `MagicLink` existe ainda para operar o fluxo normal.

Nenhuma palavra da decisão original abaixo foi removida ou contrariada —
apenas complementada com essa exceção explícita.

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
