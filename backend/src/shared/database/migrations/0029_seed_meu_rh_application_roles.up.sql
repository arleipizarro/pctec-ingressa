-- Migration: 0029_seed_meu_rh_application_roles
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Os quatro perfis do PCTEC Meu RH, declarados no catálogo genérico de
-- 0027. Nenhuma concessão nasce aqui: registrar um perfil não dá acesso
-- a ninguém, exatamente como registrar a Application em 0026 não deu.
-- Quem recebe cada perfil é decisão administrativa explícita, uma a uma
-- — inclusive `MEURH_RH_RESPONSAVEL`, que fica propositalmente SEM
-- ninguém até que a pessoa responsável pelo RH seja informada. Deduzir
-- essa pessoa por nome, cargo ou área seria conceder autorização por
-- palpite.
--
-- `permissions` é a cópia DECLARATIVA do que cada perfil inclui, para a
-- administração poder mostrar "o que este perfil dá" sem perguntar ao
-- produto. A LISTA QUE DECIDE continua sendo
-- `modules/rbac/permissions.ts` no repositório do Meu RH, revisada em
-- pull request: controle de acesso editável em produção por UPDATE é
-- precisamente o que este projeto evita. Divergência entre as duas
-- listas muda o que a tela EXIBE, nunca o que a API permite.
--
-- `public_id` determinístico pelo mesmo raciocínio de 0007/0014/0018/0026:
-- é metadado técnico estável da plataforma (não dado pessoal), e precisa
-- ser o MESMO valor entre dev/test/produção para que CLI e testes de
-- integração o referenciem sem consultar o banco antes.
--
-- Ordem (`sort_order`) do mais amplo para o mais restrito, para que a
-- lista na administração se leia como a escala que de fato é.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).

INSERT INTO application_roles
    (public_id, application_public_id, code, name, description, permissions, sort_order, status, version, created_at, updated_at)
VALUES
    ('b1f0c3a2-5d47-4e88-9a12-000000000001', '9a4e6d17-2c85-4b93-8e61-000000000001',
     'MEURH_SUPER_ADMIN', 'Super administrador do Meu RH',
     'Todas as permissões do Meu RH, incluindo administrar os próprios perfis e consultar a auditoria.',
     JSON_ARRAY('meurh.access','meurh.self.view','meurh.collaborators.admin','meurh.org_structure.admin','meurh.catalog.admin','meurh.campaigns.admin','meurh.campaigns.answer','meurh.responses.view','meurh.reports.export','meurh.team.view','meurh.team.participation.view','meurh.roles.admin','meurh.audit.view','meurh.vacations.admin','meurh.benefits.admin','meurh.payslips.admin','meurh.salaries.view','meurh.salaries.admin'),
     10, 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),

    ('b1f0c3a2-5d47-4e88-9a12-000000000002', '9a4e6d17-2c85-4b93-8e61-000000000001',
     'MEURH_RH_RESPONSAVEL', 'Responsável pelo RH',
     'Administra pessoas, estrutura e campanhas, e vê resultados conforme a política de cada campanha. Não administra a plataforma nem concede perfis.',
     JSON_ARRAY('meurh.access','meurh.self.view','meurh.collaborators.admin','meurh.org_structure.admin','meurh.catalog.admin','meurh.campaigns.admin','meurh.campaigns.answer','meurh.responses.view','meurh.reports.export','meurh.team.view','meurh.team.participation.view','meurh.audit.view','meurh.vacations.admin','meurh.benefits.admin','meurh.payslips.admin','meurh.salaries.view','meurh.salaries.admin'),
     20, 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),

    ('b1f0c3a2-5d47-4e88-9a12-000000000003', '9a4e6d17-2c85-4b93-8e61-000000000001',
     'MEURH_GESTOR', 'Gestor',
     'Consulta os próprios dados, a equipe direta e a estrutura subordinada, e acompanha a participação dos liderados. Não vê respostas individuais nem administra campanhas.',
     JSON_ARRAY('meurh.access','meurh.self.view','meurh.campaigns.answer','meurh.team.view','meurh.team.participation.view'),
     30, 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),

    ('b1f0c3a2-5d47-4e88-9a12-000000000004', '9a4e6d17-2c85-4b93-8e61-000000000001',
     'MEURH_COLABORADOR', 'Colaborador',
     'Consulta os próprios dados e responde as campanhas para as quais foi convidado.',
     JSON_ARRAY('meurh.access','meurh.self.view','meurh.campaigns.answer'),
     40, 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));
