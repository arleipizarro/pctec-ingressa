-- Migration: 0004_add_checksum_and_timing_to_schema_migrations
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- v0.4.2 — MariaDB Integration.
--
-- Migration CORRETIVA nova, não uma alteração retroativa de
-- 0001_create_schema_migrations (que já está promovida em dev e nunca é
-- editada silenciosamente — ver backend/README.md, seção "Auditoria do
-- schema_migrations").
--
-- Adiciona:
--   checksum           — SHA-256 (hex, 64 chars) do conteúdo do arquivo
--                         .up.sql no momento em que a migration foi
--                         aplicada. NULL para linhas já existentes antes
--                         desta migration (0001/0002/0003 aplicadas por
--                         uma versão anterior do runner, sem checksum) —
--                         tratado como "desconhecido", nunca como
--                         incompatibilidade, pelo runner (ver
--                         MigrationRunner.ts).
--   execution_time_ms  — duração da aplicação da migration, em
--                         milissegundos. NULL pelo mesmo motivo acima.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (v0.4.2). Este arquivo é
-- material de revisão — a execução real contra pctec_ingressa_dev
-- depende do runbook desta entrega e de autorização explícita.

ALTER TABLE schema_migrations
  ADD COLUMN checksum CHAR(64) NULL
      COMMENT 'SHA-256 hex do .up.sql aplicado. NULL = aplicada antes desta coluna existir (legado, não é incompatibilidade).' AFTER id,
  ADD COLUMN execution_time_ms INT UNSIGNED NULL
      COMMENT 'Duração da aplicação, em ms. NULL = aplicada antes desta coluna existir.' AFTER applied_at;
