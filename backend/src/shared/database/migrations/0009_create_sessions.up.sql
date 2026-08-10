-- Migration: 0009_create_sessions
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/03-dominio/MODELO-DE-DOMINIO.md, seção 11; ADR-021 (id
-- interno BIGINT + public_id CHAR(36)); ADR-024 (version / optimistic
-- locking); ADR-030 (Sessão e Autenticação, Fase D).
--
-- Convenção de nomenclatura (ADR-021, mesma já aplicada em identities/
-- applications/application_accesses/credentials): id interno (BIGINT),
-- nunca exposto; public_id externo (CHAR(36)), imutável.
--
-- status ENUM('ACTIVE','REVOKED') apenas — EXPIRED é estado DERIVADO de
-- expires_at <= NOW(), nunca um terceiro valor persistido (ADR-030,
-- "Session status — sem redundância"). Nenhum job precisa marcar
-- sessões como expiradas.
--
-- token_hash CHAR(64): SHA-256 em hex do token bruto de 256 bits — o
-- token bruto NUNCA é persistido, apenas seu hash (ADR-030).
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
-- Depende de identities (0002) já existir.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (v0.6.0).

CREATE TABLE IF NOT EXISTS sessions (
    id                     BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id              CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021).',
    identity_public_id     CHAR(36)      NOT NULL
        COMMENT 'FK para identities.public_id - Session referencia Identity diretamente (mesmo padrão de credentials/application_accesses).',
    token_hash             CHAR(64)      NOT NULL
        COMMENT 'SHA-256 (hex) do token bruto de 256 bits - o token bruto NUNCA e persistido (ADR-030).',
    status                 ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE'
        COMMENT 'Somente estes dois valores - EXPIRED e derivado de expires_at <= NOW(), nunca persistido (ADR-030).',
    created_at             DATETIME(3)   NOT NULL,
    expires_at             DATETIME(3)   NOT NULL
        COMMENT 'Expiracao absoluta, fixada na criacao - sem sliding expiration nesta fase (ADR-030).',
    last_seen_at           DATETIME(3)   NULL
        COMMENT 'Reservado para validacao de sessao em requisicoes futuras - nao populado nesta fatia.',
    revoked_at             DATETIME(3)   NULL,
    revocation_reason      VARCHAR(64)   NULL
        COMMENT 'Enum fechado quando fechado em codigo - LOGOUT nesta fase; ADMIN_ACTION/CREDENTIAL_CHANGED/SECURITY_EVENT reservados (ADR-030).',
    version                BIGINT UNSIGNED NOT NULL DEFAULT 1
        COMMENT 'Controle de concorrencia otimista (ADR-024).',
    PRIMARY KEY (id),
    UNIQUE KEY uk_sessions_public_id (public_id),
    UNIQUE KEY uk_sessions_token_hash (token_hash),
    KEY idx_sessions_identity_status (identity_public_id, status),
    KEY idx_sessions_expires_at (expires_at),
    CONSTRAINT fk_sessions_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Sessoes de autenticacao - bounded context security (v0.6.0, Fase D)';
