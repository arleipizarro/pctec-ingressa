# PCTEC Ingressa

> Nome de trabalho do projeto: **PCTEC Ingressa / PCTEC Ingressa**  
> Plataforma corporativa de identidade, acesso, organizações e integração dos produtos PCTEC.

## Propósito

Centralizar identidades, autenticação, organizações, vínculos e acesso às aplicações do ecossistema PCTEC, oferecendo uma fonte única da verdade e uma porta de entrada comum para colaboradores, clientes, parceiros e contas técnicas.

## Estrutura

```text
pctec-ingressa/
├── README.md
├── docs/
│   ├── 00-executivo/
│   ├── 01-produto/
│   ├── 02-arquitetura/
│   ├── 03-dominio/
│   ├── 04-seguranca/
│   ├── 05-integracoes/
│   ├── 06-governanca/
│   ├── 07-roadmap/
│   ├── adr/
│   └── diagrams/
├── backend/
├── frontend/
├── database/
├── scripts/
└── tests/
```

## Estado

- Arquitetura conceitual: aprovada
- Produto: em concepção
- Código: ainda não iniciado
- Baseline do Portal: v1.0.9
- Próxima evolução do Portal: v1.1.0, com integração progressiva ao PCTEC Ingressa

## Regra de ouro

Nenhum produto acessará diretamente o banco de outro produto. A integração ocorrerá por APIs versionadas e eventos.
