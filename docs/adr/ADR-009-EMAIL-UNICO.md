# ADR-009 — E-mail único e obrigatório por identidade

## Contexto

O Ingressa é fonte única da verdade para identidades. Para que o e-mail
funcione como chave de contato e de login, é necessário que ele identifique
uma única identidade em todo o ecossistema.

## Decisão

Toda `Identity` possui exatamente um `email`, obrigatório no cadastro,
único globalmente e comparado de forma case-insensitive. Não há suporte a
múltiplos e-mails por identidade no MVP.

## Consequências

- Duas identidades não podem compartilhar o mesmo e-mail, mesmo com
  capitalização diferente.
- Alteração de e-mail é uma operação sensível e deve seguir fluxo de
  confirmação (Magic Link do tipo `EMAIL_CHANGE`, ver ADR-012).
- Suporte a múltiplos e-mails por identidade fica registrado como extensão
  futura, fora do MVP.

## Status

Proposto — v0.2.0 Domain Foundation.
