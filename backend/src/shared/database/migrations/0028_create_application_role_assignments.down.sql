-- Migration: 0028_create_application_role_assignments
-- Direção: DOWN
--
-- Destrutiva: apaga TODAS as concessões de perfil de aplicação,
-- inclusive o histórico de revogações. Quem tiver
-- `ApplicationAccess(..., ADMIN)` continua administrando o produto pelo
-- caminho de bootstrap, que não depende desta tabela.

DROP TABLE IF EXISTS application_role_assignments;
