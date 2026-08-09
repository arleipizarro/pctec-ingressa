-- Migration: 0008_create_credentials
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/03-dominio/MODELO-DE-DOMINIO.md, seção 9 (revisada);
-- docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md, seção 8 (revisada);
-- ADR-021 (id interno BIGINT + public_id CHAR(36)); ADR-022 (Credential
-- separada de Identity); ADR-024 (version / optimistic locking); ADR-029
-- (Credential e Autenticação, Fase C).
--
-- Convenção de nomenclatura (ADR-021, mesma já aplicada em identities/
-- applications/application_accesses): id interno (BIGINT), nunca exposto;
-- public_id externo (CHAR(36)), imutável.
--
-- UNIQUE(identity_public_id, type): existe no máximo UMA linha de
-- Credential por combinação identidade+tipo, PARA SEMPRE — rotação de
-- senha (futura) é um UPDATE nesta mesma linha (password_hash,
-- version += 1), nunca um novo INSERT (ADR-029, "Rotação de senha e
-- unicidade"). Isso é o que torna esta constraint incondicional viável e
-- correta, sem depender de coluna gerada para condicionar a status.
--
-- status ENUM('ACTIVE','REVOKED') apenas — PENDING/LOCKED/DISABLED foram
-- avaliados e explicitamente rejeitados (ADR-029, "Status de Credential").
-- Nenhuma coluna failed_attempts/locked_until nesta migration — lockout
-- deferido explicitamente (ADR-029, "Lockout").
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
-- Depende de identities (0002) já existir.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (v0.5.x).

CREATE TABLE IF NOT EXISTS credentials (
    id                     BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id              CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021).',
    identity_public_id     CHAR(36)      NOT NULL
        COMMENT 'FK para identities.public_id - Credential referencia Identity diretamente (mesmo padrão de application_accesses, ADR-025/028).',
    type                   ENUM('LOCAL_PASSWORD') NOT NULL
        COMMENT 'Enum fechado nesta fase - LOCAL_PASSWORD preservado, nao renomeado para PASSWORD (ADR-029). Sem campos de OAuth/Entra ainda.',
    password_hash          VARCHAR(255)  NOT NULL
        COMMENT 'PHC string completa do Argon2id - salt e parametros de custo embutidos, sem coluna separada (ADR-029). NOT NULL: unico type existente hoje sempre tem senha.',
    status                 ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE'
        COMMENT 'Somente estes dois valores - PENDING/LOCKED/DISABLED avaliados e rejeitados (ADR-029).',
    last_authenticated_at  DATETIME(3)   NULL
        COMMENT 'Reservado para a Fase D (login real) - nao populado por nenhum comando desta fatia.',
    version                BIGINT UNSIGNED NOT NULL DEFAULT 1
        COMMENT 'Controle de concorrencia otimista (ADR-024).',
    created_at             DATETIME(3)   NOT NULL,
    updated_at             DATETIME(3)   NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_credentials_public_id (public_id),
    UNIQUE KEY uk_credentials_identity_type (identity_public_id, type),
    KEY idx_credentials_status (identity_public_id, type, status),
    CONSTRAINT fk_credentials_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Credenciais de autenticacao - bounded context security (v0.5.x, Fase C)';
