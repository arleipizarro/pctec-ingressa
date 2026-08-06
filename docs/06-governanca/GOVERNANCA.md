# Governança

## Fonte única

| Conceito | Dono |
|---|---|
| Identidades | PCTEC Ingressa |
| Organizações e grupos | PCTEC Ingressa |
| Autenticação | PCTEC Ingressa |
| Sessões | PCTEC Ingressa |
| Aplicações e acesso global | PCTEC Ingressa |
| Contratos | PCTEC Portal |
| Patrimônio e logística | PCTEC HUB |
| Tickets e SLA | PCTEC Helpdesk |
| Regras específicas | Produto responsável |

## Fluxo de mudanças

1. Decisão arquitetural.
2. ADR.
3. Implementação em branch.
4. Testes no DEV.
5. Homologação.
6. Promoção para produção.
7. Tag de versão.

## Proibição

Nenhum produto deve consultar ou alterar diretamente o banco de outro produto.
