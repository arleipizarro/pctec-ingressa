-- Migration: 0027_create_application_roles
-- Direção: DOWN
--
-- Destrutiva: apaga o catálogo de perfis de TODAS as aplicações. Só é
-- reversível nesta ordem porque 0028 (as concessões) referencia esta
-- tabela e cai antes.
--
-- Quem tiver `ApplicationAccess(..., ADMIN)` continua administrando
-- cada produto: o caminho de bootstrap não depende desta tabela.

DROP TABLE IF EXISTS application_roles;
