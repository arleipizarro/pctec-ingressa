# ADR-007 — Autorização em duas camadas

## Nota de atualização (v0.2.0 — Domain Foundation)

Este ADR foi expandido nesta entrega para detalhar contexto e
consequências. A decisão original (v0.1.0) permanece inalterada; nenhuma
palavra da decisão foi removida ou contrariada. A expansão foi feita para
tornar explícita a fronteira entre autorização global e local, conforme
exigido pela documentação de v0.2.0 (Constituição da Plataforma, seção 7;
Software Architecture Blueprint, seção 4).

## Contexto

Produtos consumidores precisam saber se uma identidade pode "entrar" no
produto, mas também precisam decidir o que essa identidade pode fazer
dentro do produto (papéis, permissões finas, regras de negócio). Modelar as
duas coisas em um único lugar acoplaria o Ingressa a regras de negócio de
cada consumidor, contrariando sua missão de ser um control plane
independente de domínio de negócio.

## Decisão

O Ingressa controla acesso global às aplicações. Cada produto controla permissões internas de negócio.

Formalizando: a autorização é dividida em duas camadas não sobrepostas.

1. **Autorização global (Ingressa):** representada por `ApplicationAccess`
   — decide apenas se a identidade/perfil tem acesso à aplicação como um
   todo.
2. **Autorização local (produto consumidor):** decide o que a identidade
   pode fazer dentro do produto. Modelada e armazenada inteiramente pelo
   produto consumidor, em seu próprio banco.

O Ingressa nunca modela permissões de domínios consumidores (chamados,
patrimônio, contratos, faturamento, logística, SLA, ou equivalentes).

## Consequências

- Nenhuma tabela de permissões finas por funcionalidade existe no banco do
  Ingressa.
- Produtos consumidores devem implementar e manter seu próprio modelo de
  papéis/permissões internas.
- Evitar coluna simplista como `admin=true` em `Identity`; acesso
  administrativo à plataforma, se necessário, é modelado como
  `ApplicationAccess` a uma aplicação administrativa própria.

## Status

Aprovado (v0.1.0), expandido (v0.2.0 — Domain Foundation).
