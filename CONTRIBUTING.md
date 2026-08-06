# Contribuindo com o PCTEC Ingressa

## Fluxo

1. Toda mudança nasce em uma branch `feature/*`, `fix/*` ou `docs/*`.
2. Mudanças arquiteturais exigem ADR.
3. Nenhum código entra em `main` sem validação.
4. APIs devem ser versionadas.
5. Nenhum produto pode acessar diretamente o banco de outro produto.
6. Segredos nunca devem ser versionados.

## Branches

- `main`: versões estáveis
- `dev`: integração e homologação
- `feature/*`: funcionalidades
- `fix/*`: correções
- `hotfix/*`: correções urgentes de produção
- `docs/*`: documentação
