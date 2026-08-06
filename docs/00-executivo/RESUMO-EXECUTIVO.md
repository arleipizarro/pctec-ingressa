# Resumo Executivo — PCTEC Ingressa

## Contexto

A PCTEC possui diversos produtos que, hoje ou futuramente, precisam compartilhar identidades, organizações, autenticação e acesso. A manutenção isolada desses recursos em cada aplicação aumenta duplicidade, inconsistência, risco de segurança e custo operacional.

## Decisão

Foi aprovada a criação do **PCTEC Ingressa**, também concebido como a plataforma de identidade e acesso da PCTEC. O produto será responsável pelo Cadastro Mestre de Identidades e Organizações, autenticação centralizada, sessões, aplicações e Single Sign-On.

## Resultado esperado

- Um cadastro oficial para cada pessoa.
- Um cadastro oficial para cada grupo empresarial e empresa.
- Uma autenticação única para o ecossistema.
- Um painel próprio de gestão de identidades e acessos.
- Redução de cadastros duplicados e divergentes.
- Auditoria centralizada.
- Base para MFA, passkeys, federação e integrações futuras.

## Sistemas no ecossistema inicial

- PCTEC-HELPDESK
- PCTEC-PROTECT
- PCTEC-OMIE
- PCTEC-PARTNERS
- PCTEC-PORTAL
- PCTEC-JIRA
- PCTEC-CLAIM
- PCTEC-EXCHANGE
- PCTEC-TOMTICKET

A lista original continha PCTEC-HELPDESK duas vezes; o catálogo foi normalizado sem duplicação.

## Posicionamento arquitetural

O PCTEC Ingressa será o **control plane** do ecossistema: identifica pessoas, organizações e aplicações e governa o acesso global. Cada produto continua responsável por suas regras de negócio e permissões internas.

## Próximos passos

1. Fechar as ADRs restantes.
2. Finalizar o modelo de domínio.
3. Definir os fluxos de autenticação e SSO.
4. Projetar o banco e as APIs.
5. Construir o MVP.
6. Ingressar inicialmente o PCTEC Portal.
