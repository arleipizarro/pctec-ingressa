# ADR-023 — Múltiplas credenciais futuras por Identity

## Contexto

O modelo relacional da v0.2.0 já previa que `credentials.type` fosse um
enum, mas restringia-o a `LOCAL_PASSWORD`. À medida que a plataforma evolui
para suportar métodos de autenticação modernos, uma `Identity` poderá
precisar de mais de um tipo de credencial simultaneamente (ex.: senha e
chave de acesso).

## Decisão

Uma `Identity` poderá, no futuro, possuir múltiplas `Credential`
simultaneamente, cada uma de um tipo distinto. Os tipos previstos no
domínio (reservados, não necessariamente implementados no MVP) são:

- `PASSWORD`;
- `PASSKEY`;
- `FIDO2`;
- `EXTERNAL_PROVIDER`;
- `CERTIFICATE`;
- `API_KEY`.

Esta decisão formaliza apenas a possibilidade estrutural (o enum de tipos e
a cardinalidade "uma identidade, várias credenciais, uma por tipo ativo").
Não define quais tipos são implementados nesta fase, nem prazo. Implementar
qualquer tipo além do necessário para o MVP funcional permanece **Pendente
de decisão**.

`MagicLink` não é, e nunca deve ser tratado como, um tipo de `Credential` —
é infraestrutura de fluxo temporário e de uso único (ver ADR-012), distinta
por natureza de uma credencial permanente.

## Consequências

- O enum de tipos de `Credential` é ampliado em relação à v0.2.0
  (`LOCAL_PASSWORD` isolado) para o conjunto acima, mantendo compatibilidade
  conceitual — `LOCAL_PASSWORD` da v0.2.0 corresponde a `PASSWORD` nesta
  nomenclatura revisada.
- Regras de negócio sobre quantas credenciais ativas do mesmo tipo uma
  identidade pode ter simultaneamente (hoje: no máximo uma por tipo)
  continuam válidas.

## Status

Proposto — v0.3.0 Identity Core (documental).
