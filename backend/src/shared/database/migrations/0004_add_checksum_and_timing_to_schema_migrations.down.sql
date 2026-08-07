-- Migration: 0004_add_checksum_and_timing_to_schema_migrations
-- Direção: DOWN
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

ALTER TABLE schema_migrations
  DROP COLUMN checksum,
  DROP COLUMN execution_time_ms;
