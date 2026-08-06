# ADR-017 — Identity como Aggregate Root do diretório, não de toda a segurança

## Contexto

O ADR-014 já estabeleceu bounded contexts separados (`identity`, `security`,
entre outros). Falta formalizar explicitamente o papel de `Identity` como
Aggregate Root: ela é a raiz do diretório de pessoas reconhecidas pela
plataforma, não a raiz de um agregado que englobe autenticação, sessão ou
autorização.

Sem essa formalização, há risco de o agregado `Identity` crescer de forma
não controlada — absorvendo `Credential`, `Session`, `MagicLink` — o que
violaria a separação de contextos já decidida e criaria um agregado
transacional grande, difícil de evoluir e propenso a conflitos de
concorrência.

## Decisão

`Identity` é o Aggregate Root do bounded context `identity` — o diretório
de entidades digitais reconhecidas pela Plataforma PCTEC. Ela é responsável
exclusivamente por:

- existência e identificação da entidade (`public_id`, `type`);
- dados de diretório (`full_name`, `email`, `cpf`);
- ciclo de vida de diretório (`status`, `login_enabled`).

**Nota de correção (v0.3.0 — ADR-025):** esta lista incluía originalmente
"perfis de classificação (`IdentityProfile`)" como responsabilidade de
`Identity`. Essa classificação (`EMPLOYEE`, `CUSTOMER`, `PARTNER`,
`SUPPLIER`) foi removida do agregado `Identity` por ADR-025 — depende da
relação entre `Identity` e `Organization`, e pertence ao `Membership`
(bounded context `organization`/`access`), não ao diretório de identidade.
`Identity`, nesta especificação, não possui nenhuma entidade filha.

`Identity` não é a raiz de segurança da plataforma. Autenticação
(`Credential`), sessão (`Session`, `RefreshToken`) e fluxos temporários
(`MagicLink`) são agregados próprios, do bounded context `security`, que
referenciam `Identity` por `public_id`, mas não são modelados como
entidades filhas internas do agregado `Identity`.

## Consequências

- Transações que alteram `Identity` não precisam bloquear ou versionar
  `Credential`/`Session` junto, e vice-versa.
- Mudança de senha, criação de sessão ou consumo de magic link não geram
  conflito de `version` em `Identity` (ver ADR-024).
- Fica explícito que "identidade existe" é uma afirmação independente de
  "identidade pode autenticar agora".

## Status

Proposto — v0.3.0 Identity Core (documental).
