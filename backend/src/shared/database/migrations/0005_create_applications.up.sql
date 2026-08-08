-- Migration: 0005_create_applications
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/03-dominio/MODELO-DE-DOMINIO.md, seção 7 (revisada
-- nesta migration); docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md, seção
-- 6 (revisada); ADR-021 (id interno BIGINT + public_id CHAR(36));
-- ADR-024 (version / optimistic locking); ADR-028.
--
-- Convenção de nomenclatura (ADR-021, mesma já aplicada em `identities`
-- desde a v0.4.0): `id` é a chave interna (BIGINT), nunca exposta fora do
-- banco; `public_id` é o identificador externo (UUID textual, CHAR(36)),
-- imutável. Diverge deliberadamente da convenção histórica de
-- `MODELO-RELACIONAL-PROPOSTO.md` v0.2.0 (UUID público em formato binário
-- de 16 bytes + coluna interna separada) pelo mesmo motivo já registrado
-- em ADR-021 — convergência geral de nomenclatura permanece Pendente de
-- decisão, tratada tabela a tabela conforme cada uma é efetivamente
-- implementada.
--
-- Exatamente UMA instrução executável neste arquivo (runner exige isso —
-- ver MigrationRunner.ts, assertSingleStatement). O seed técnico da
-- Application PCTEC_INGRESSA está em migration própria (0007), não aqui.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (v0.5.0).

CREATE TABLE IF NOT EXISTS applications (
    id                     BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id              CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021).',
    code                   VARCHAR(64)   NOT NULL
        COMMENT 'Identificador tecnico curto e estavel, ex.: PCTEC_INGRESSA. Unico e imutavel (MODELO-DE-DOMINIO.md, secao 7).',
    name                   VARCHAR(255)  NOT NULL,
    status                 ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    version                BIGINT UNSIGNED NOT NULL DEFAULT 1
        COMMENT 'Controle de concorrencia otimista (ADR-024), por consistencia - sem comando de mutacao nesta fatia.',
    created_at             DATETIME(3)   NOT NULL,
    updated_at             DATETIME(3)   NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_applications_public_id (public_id),
    UNIQUE KEY uk_applications_code (code)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Catalogo de aplicacoes do ecossistema PCTEC - bounded context application (v0.5.0)';
