-- Migration: 0033_seed_portal_application_roles
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- O perfil de ADMINISTRADOR GLOBAL do PCTEC Portal, declarado no
-- catálogo genérico de 0027 (camada 2 de ADR-007, ADR-036).
--
-- Por que existe. No login legado, o colaborador da PCTEC entrava pelo
-- SSO do pctec-sis e, com o módulo `portal_cliente`, escolhia QUALQUER
-- cliente e navegava com a visão dele. Com o Portal autenticando só pelo
-- Ingressa, essa capacidade sumiu: a camada 1 (`PCTEC_PORTAL`/`USER`) e
-- as Memberships dizem só em quais organizações a pessoa ENTRA, e nada
-- diz "esta pessoa vê todas". Este perfil é esse "vê todas".
--
-- Por que NÃO é `access_profile = ADMIN`. `ADMIN` é enum de plataforma
-- (ADR-028/ADR-032) e já tem outro significado; e `ADMIN` em
-- `PCTEC_INGRESSA` (administrar a plataforma) ou em qualquer outro
-- produto não pode, por acidente de nome, virar leitura de todos os
-- clientes do Portal. Administrador de CLIENTE também não: ele continua
-- restrito às próprias Memberships.
--
-- Nenhuma concessão nasce aqui (mesmo princípio de 0026/0029):
-- registrar o perfil não é conceder o perfil. Quem o recebe é decisão
-- administrativa explícita, uma a uma, com evidência do papel anterior.
--
-- `permissions` é a cópia DECLARATIVA para a administração exibir. A
-- lista que DECIDE é `backend/utils/permissoesDoPortal.js` no
-- repositório do Portal, revisada em pull request.
--
-- `public_id` determinístico pelo mesmo raciocínio de 0029.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).

INSERT INTO application_roles
    (public_id, application_public_id, code, name, description, permissions, sort_order, status, version, created_at, updated_at)
VALUES
    ('c4d8e2f1-6a3b-4c7d-9e5f-000000000001', '3f9c1a2e-7d4b-4e5a-9c3f-000000000001',
     'PORTAL_ADMIN_GLOBAL', 'Administrador global do Portal',
     'Colaborador da PCTEC que escolhe qualquer cliente do Portal e navega com a visão dele. Não altera dados do cliente e não substitui as organizações da própria conta.',
     JSON_ARRAY('portal:clientes:visualizar_todos'),
     10, 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));
