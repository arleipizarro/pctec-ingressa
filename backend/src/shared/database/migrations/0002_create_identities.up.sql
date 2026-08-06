-- Migration: 0002_create_identities
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md, seção 1;
-- ADR-018 (tipos, MVP=HUMAN), ADR-019 (estados), ADR-020 (exclusão
-- lógica), ADR-021 (id interno BIGINT + public_id CHAR(36)), ADR-024
-- (version / optimistic locking).
--
-- Convenção de nomenclatura desta tabela (ADR-021): `id` é a chave
-- interna (BIGINT), nunca exposta fora do banco; `public_id` é o
-- identificador externo (UUID textual, CHAR(36)), imutável.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (v0.4.0 Slice 1).

CREATE TABLE IF NOT EXISTS identities (
    id                              BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id                       CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021).',
    type                            ENUM('HUMAN','SERVICE','APPLICATION','DEVICE','AGENT') NOT NULL
        COMMENT 'Apenas HUMAN aceito em operações de criação no MVP (ADR-018).',
    full_name                       VARCHAR(255)  NOT NULL,
    email                           VARCHAR(255)  NOT NULL
        COMMENT 'Valor de exibição.',
    email_normalized                VARCHAR(255)  NOT NULL
        COMMENT 'Forma canônica (lowercase) usada para unicidade case-insensitive.',
    cpf                             VARCHAR(14)   NULL
        COMMENT 'Opcional. Valor de exibição. Nunca retornar integralmente em eventos/logs.',
    cpf_normalized                  VARCHAR(11)   NULL
        COMMENT 'Opcional. Somente dígitos, usado para unicidade quando preenchido.',
    status                          ENUM('PENDING','ACTIVE','BLOCKED','INACTIVE','DELETED') NOT NULL DEFAULT 'PENDING'
        COMMENT 'Ver máquina de estados em IDENTITY-DOMAIN-DESIGN.md, seção 10 (ADR-019).',
    login_enabled                   TINYINT(1)    NOT NULL DEFAULT 0
        COMMENT 'Independente de status (ver invariantes de autenticação).',
    version                         BIGINT UNSIGNED NOT NULL DEFAULT 1
        COMMENT 'Controle de concorrência otimista (ADR-024).',
    created_at                      DATETIME(3)   NOT NULL,
    created_by_identity_public_id   CHAR(36)      NULL
        COMMENT 'Actor que criou; pode ser NULL apenas se actor for o marcador SYSTEM em nível de aplicação.',
    updated_at                      DATETIME(3)   NOT NULL,
    updated_by_identity_public_id   CHAR(36)      NULL,
    deleted_at                      DATETIME(3)   NULL
        COMMENT 'Preenchido apenas quando status = DELETED (ADR-020). Sem exclusão física.',
    deleted_by_identity_public_id   CHAR(36)      NULL,
    deletion_reason                 VARCHAR(64)   NULL
        COMMENT 'Código categórico, não texto livre. Lista fechada de valores ainda Pendente de decisão.',
    PRIMARY KEY (id),
    UNIQUE KEY uk_identities_public_id (public_id),
    UNIQUE KEY uk_identities_email_normalized (email_normalized),
    UNIQUE KEY uk_identities_cpf_normalized (cpf_normalized),
    KEY idx_identities_status (status),
    KEY idx_identities_type (type)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Diretório mestre de identidades — bounded context identity (v0.4.0 Slice 1)';
