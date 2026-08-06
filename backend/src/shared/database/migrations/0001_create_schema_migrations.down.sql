-- Migration: 0001_create_schema_migrations
-- Direção: DOWN
--
-- Reverte a criação da tabela de controle de migrations. Só deve ser
-- executada como parte de um rollback completo (após reverter todas as
-- migrations que dependem dela ter existido).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

DROP TABLE IF EXISTS schema_migrations;
