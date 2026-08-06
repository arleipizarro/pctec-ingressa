# Product Requirements Document — PCTEC Ingressa

## 1. Problema

Cada produto PCTEC pode manter usuários, organizações e regras de acesso próprias, provocando duplicidade, divergência, retrabalho e risco.

## 2. Objetivo do produto

Fornecer uma plataforma única para:

- Cadastro Mestre de Identidades.
- Cadastro Mestre de Organizações e grupos empresariais.
- Autenticação centralizada.
- Single Sign-On.
- Gestão de aplicações.
- Gestão de sessões e credenciais.
- Vínculos entre identidades e organizações.
- Auditoria de segurança e administração.

## 3. Personas

- Administrador da plataforma.
- Administrador de organização.
- Colaborador PCTEC.
- Cliente.
- Parceiro.
- Fornecedor.
- Conta técnica ou integração.

## 4. Escopo do MVP

- Identidades de pessoas.
- Organizações: grupo empresarial e empresa.
- Memberships com escopo de organização ou descendentes.
- Login local.
- Primeiro acesso.
- Recuperação de senha.
- Sessões e revogação.
- Catálogo de aplicações.
- Concessão de acesso global às aplicações.
- Painel administrativo.
- Área Minha Conta.
- API v1.
- Auditoria básica.

## 5. Fora do MVP

- LDAP.
- Regras operacionais de cada produto.
- Permissões finas de patrimônio, tickets, contratos ou rollout.
- Passkeys.
- Federação com múltiplos provedores.
- Barramento dedicado de eventos.

## 6. Primeiro consumidor

PCTEC Portal, evoluindo da versão 1.0.9 para 1.1.0.

## 7. Critérios de sucesso

- Usuário acessa o Portal por autenticação central.
- Uma identidade pode ter múltiplos perfis e vínculos.
- Empresas e grupos possuem cadastro mestre.
- Sessões podem ser auditadas e revogadas.
- Nenhum consumidor acessa o banco do Ingressa diretamente.
