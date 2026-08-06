# ADR-010 — CPF opcional e único quando informado

## Contexto

Nem toda identidade cadastrada no Ingressa necessariamente possui CPF
disponível no momento do cadastro (por exemplo, contas técnicas futuras ou
cadastros parciais). Ao mesmo tempo, quando o CPF existe, ele não pode se
repetir entre identidades distintas.

## Decisão

O campo `document_number` (CPF) é opcional em `Identity`. Quando informado,
deve ser normalizado (armazenamento apenas com dígitos) e deve ser único
entre as identidades que o informaram.

## Consequências

- É possível ter múltiplas identidades sem CPF informado, sem violar
  unicidade (unicidade se aplica apenas a valores não nulos).
- A normalização do CPF é responsabilidade da camada de aplicação antes da
  persistência.
- Validação de dígito verificador de CPF é Pendente de decisão de
  implementação (fora do escopo desta entrega).

## Status

Proposto — v0.2.0 Domain Foundation.
