-- Migration: 0031_seed_central_servicos_application_roles
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Os dois perfis da PCTEC Central de Serviços N1, no catálogo genérico
-- de 0027. Nenhuma concessão nasce aqui: quem recebe cada perfil é
-- decisão administrativa explícita, uma a uma.
--
-- APROVADOR_TI e N1_OPERADOR são perfis DISTINTOS de propósito: aprovar
-- e executar são gestos diferentes, registrados separadamente no
-- produto, mesmo quando a mesma pessoa tem os dois (exceção do piloto).
--
-- `permissions` é a cópia DECLARATIVA para a administração exibir. A
-- LISTA QUE DECIDE é `src/dominio/papeis.ts` no repositório
-- `pctec-servicos`, revisada em pull request.
--
-- Não há perfil de Dispatcher: no piloto, o encaminhamento é feito pela
-- tela de filas do Helpdesk, e o papel ainda não foi designado.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).

INSERT INTO application_roles
    (public_id, application_public_id, code, name, description, permissions, sort_order, status, version, created_at, updated_at)
VALUES
    ('e5a1b7d3-9c24-4f6b-a8e3-000000000001', '7e2d4c86-3b51-4f9a-8d20-000000000001',
     'N1_OPERADOR', 'Operador N1',
     'Valida a solicitação vinda do Helpdesk, executa o serviço aprovado, confere o resultado e registra a resolução. Não aprova.',
     JSON_ARRAY('servicos.solicitacao.ver','servicos.solicitacao.triar','servicos.solicitacao.executar','servicos.solicitacao.responder_publico','servicos.solicitacao.validar_resultado','servicos.solicitacao.resolver'),
     10, 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),

    ('e5a1b7d3-9c24-4f6b-a8e3-000000000002', '7e2d4c86-3b51-4f9a-8d20-000000000001',
     'APROVADOR_TI', 'Aprovador de TI',
     'Aprova ou reprova, com justificativa, a execução de cada solicitação. Não executa.',
     JSON_ARRAY('servicos.solicitacao.ver','servicos.aprovacao.decidir'),
     20, 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));
