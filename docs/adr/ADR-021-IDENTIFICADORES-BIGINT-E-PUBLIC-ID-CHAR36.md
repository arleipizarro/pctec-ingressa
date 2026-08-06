# ADR-021 — Identificadores de Identity: BIGINT interno + UUID público CHAR(36)

## Contexto

A v0.2.0 (`MODELO-RELACIONAL-PROPOSTO.md`) propôs, para todas as
entidades, a convenção `id BINARY(16)` como UUID público e `internal_id
BIGINT UNSIGNED AUTO_INCREMENT` como chave primária interna. O objetivo
declarado era eficiência de índice ao armazenar o UUID em formato binário.

Na especificação detalhada do núcleo `Identity` (v0.3.0), o Platform
Architect determinou uma convenção de nomenclatura e tipo diferente,
especificamente para `Identity`, priorizando operabilidade e diagnóstico
direto em MariaDB (poder inspecionar e comparar o identificador público em
consultas manuais sem função de conversão) sobre o ganho de espaço de
`BINARY(16)`.

## Decisão

Para a entidade `Identity`, os identificadores passam a ser:

- `id BIGINT UNSIGNED` — chave primária interna, autoincremental. **Nunca**
  sai por API, token, URL, log voltado a consumidores ou evento.
- `public_id CHAR(36)` — identificador público, UUID em formato textual
  (ex.: `550e8400-e29b-41d4-a716-446655440000`), imutável, sem significado
  de negócio. É o único identificador de `Identity` exposto externamente.

Esta é uma **correção explícita de nomenclatura** em relação à v0.2.0, não
uma mudança silenciosa: anteriormente, a coluna pública era chamada `id` (e
armazenada como `BINARY(16)`) e a interna era `internal_id`. A partir desta
decisão, para `Identity`, o nome `id` passa a se referir à chave interna, e
`public_id` ao identificador externo — o inverso do nomeado na v0.2.0.

`CHAR(36)` foi escolhido em vez de `BINARY(16)` para `Identity`
especificamente pela vantagem de diagnóstico direto (leitura e cópia
imediata em ferramentas de administração de banco, sem conversão), aceitando
o custo adicional de espaço e indexação em troca dessa operabilidade.

## Consequências

- `docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md` é atualizado **apenas na
  tabela `identities`** para refletir `id BIGINT UNSIGNED
  AUTO_INCREMENT` (PK) e `public_id CHAR(36) UNIQUE NOT NULL`.
- As demais tabelas do modelo relacional (`organizations`,
  `identity_profiles`, `memberships`, `applications`,
  `application_access`, `credentials`, `magic_links`, `sessions`,
  `refresh_tokens`, `audit_events`) **mantêm a convenção da v0.2.0**
  (`id BINARY(16)` público / `internal_id BIGINT` interno) nesta entrega,
  pois o escopo desta v0.3.0 é restrito ao núcleo Identity. A convergência
  ou não de nomenclatura entre `Identity` e as demais entidades fica
  registrada como **Pendente de decisão** para uma revisão de consistência

  **Nota de correção (ADR-025, posterior a este ADR):** `identity_profiles`
  foi removida do modelo relacional — não é mais uma tabela válida. A
  citação acima é preservada como registro histórico do momento em que
  este ADR foi escrito (a tabela ainda existia quando esta lista foi
  redigida).
  de plataforma futura.
- Tabelas que referenciam `Identity` por chave estrangeira devem referenciar
  `identities.id` (a chave interna `BIGINT`) para fins de integridade
  referencial interna ao banco, nunca `public_id`, embora `public_id` seja
  o valor usado em contratos de API e eventos.

## Status

Proposto — v0.3.0 Identity Core (documental). Escopo desta correção
restrito à entidade `Identity`.
