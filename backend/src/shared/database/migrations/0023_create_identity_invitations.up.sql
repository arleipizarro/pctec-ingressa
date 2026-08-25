-- Migration: 0023_create_identity_invitations
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: ADR-021 (id interno BIGINT + public_id CHAR(36)); ADR-022
-- (Credential separada de Identity); ADR-029 (Credential e Autenticação).
--
-- Convite administrativo de primeiro acesso (v1.0). Usuários importados
-- do Helpdesk chegam ACTIVE, login_enabled=0 e sem Credential — o
-- convite é o caminho pelo qual essa pessoa define a PRÓPRIA senha no
-- Ingressa. Nenhuma senha é gerada, transportada ou enviada por e-mail.
--
-- token_hash CHAR(64): SHA-256 (hex) do token bruto de 256 bits — o
-- token bruto NUNCA é persistido, mesmo princípio de sessions.token_hash
-- (0009) e sso_authorization_codes.code_hash (0022). Também nunca é
-- logado: o link é exibido uma única vez ao ADMIN (modo MANUAL_DEV) ou
-- entregue pelo adaptador de e-mail, e depois só existe no navegador de
-- quem o recebeu.
--
-- status ENUM('PENDING','CONSUMED','REVOKED') — EXPIRED é estado
-- DERIVADO de expires_at <= NOW(), nunca um quarto valor persistido
-- (mesmo princípio de sessions, ADR-030). Nenhum job precisa varrer a
-- tabela.
--
-- UNIQUE parcial não existe em MariaDB; a regra "no máximo um convite
-- PENDING por Identity" é aplicada pela revogação em massa dentro da
-- MESMA transação que cria o convite novo (CreateIdentityInvitationService).
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
-- Depende de identities (0002) já existir.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

CREATE TABLE IF NOT EXISTS identity_invitations (
    id                     BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id              CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021). NUNCA e o token do convite.',
    identity_public_id     CHAR(36)      NOT NULL
        COMMENT 'FK para identities.public_id - quem foi convidado.',
    token_hash             CHAR(64)      NOT NULL
        COMMENT 'SHA-256 (hex) do token bruto de 256 bits - o token bruto NUNCA e persistido nem logado.',
    status                 ENUM('PENDING','CONSUMED','REVOKED') NOT NULL DEFAULT 'PENDING'
        COMMENT 'EXPIRED e derivado de expires_at <= NOW(), nunca persistido.',
    delivery_mode          ENUM('MANUAL_DEV','EMAIL') NOT NULL
        COMMENT 'Como o link foi entregue. MANUAL_DEV = exibido uma unica vez ao ADMIN; EMAIL = adaptador SMTP proprio do Ingressa.',
    invited_by_public_id   CHAR(36)      NOT NULL
        COMMENT 'FK para identities.public_id - o ADMIN autenticado que emitiu o convite. Nunca BOOTSTRAP: aqui sempre existe ator real.',
    correlation_id         CHAR(36)      NOT NULL,
    created_at             DATETIME(3)   NOT NULL,
    expires_at             DATETIME(3)   NOT NULL
        COMMENT 'Validade configuravel, padrao 24h (INVITATION_TTL_SECONDS).',
    consumed_at            DATETIME(3)   NULL
        COMMENT 'Carimbo de uso unico. A trava real de replay e o UPDATE ... WHERE status = PENDING AND consumed_at IS NULL.',
    revoked_at             DATETIME(3)   NULL,
    revocation_reason      VARCHAR(64)   NULL
        COMMENT 'SUPERSEDED quando um convite novo revoga os anteriores da mesma Identity; ADMIN_ACTION reservado.',
    PRIMARY KEY (id),
    UNIQUE KEY uk_identity_invitations_public_id (public_id),
    UNIQUE KEY uk_identity_invitations_token_hash (token_hash),
    KEY idx_identity_invitations_identity_status (identity_public_id, status),
    KEY idx_identity_invitations_expires_at (expires_at),
    CONSTRAINT fk_identity_invitations_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_identity_invitations_inviter
        FOREIGN KEY (invited_by_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Convites administrativos de primeiro acesso - bounded context security (v1.0)';
