-- Migration: 0001_create_schema_migrations
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Tabela de controle de migrations aplicadas. Toda migration subsequente
-- registra seu próprio `id` aqui após ser aplicada com sucesso.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (v0.4.0 Slice 1). Este arquivo
-- é material de revisão; a execução real fica para uma fatia futura, após
-- aprovação explícita do Product Owner/Platform Architect.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id            VARCHAR(64)   NOT NULL COMMENT 'Identificador da migration, ex.: 0001_create_schema_migrations',
    applied_at    DATETIME(3)   NOT NULL COMMENT 'Momento em que a migration foi aplicada',
    PRIMARY KEY (id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Controle de migrations aplicadas ao banco pctec_ingressa';
