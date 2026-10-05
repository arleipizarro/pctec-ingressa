-- Migration: 0034_create_password_reset_tokens
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: ADR-021 (id interno BIGINT + public_id CHAR(36)); ADR-029
-- (Credential e Autenticação); ADR-030 (EXPIRED derivado); ADR-037
-- (recuperação de senha pelo próprio titular).
--
-- "Esqueci minha senha". Até aqui, quem perdia a senha dependia de um
-- ADMIN — e a recuperação administrativa (ResetAdminPasswordService) só
-- existe para o próprio ADMIN, por CLI. Esta tabela guarda o pedido de
-- redefinição feito pelo TITULAR, a partir do e-mail.
--
-- token_hash CHAR(64): SHA-256 (hex) do token bruto de 256 bits — o
-- token bruto NUNCA é persistido nem logado, mesmo princípio de
-- sessions.token_hash (0009), sso_authorization_codes.code_hash (0022) e
-- identity_invitations.token_hash (0023). O token só existe no link do
-- e-mail, no FRAGMENTO da URL.
--
-- status ENUM('PENDING','CONSUMED','REVOKED') — EXPIRED é DERIVADO de
-- expires_at <= NOW(), nunca persistido. Nenhum job varre a tabela.
--
-- UNIQUE parcial não existe em MariaDB; "no máximo um pedido PENDING por
-- Identity" é aplicado pela revogação em massa (SUPERSEDED) dentro da
-- MESMA transação que cria o pedido novo (RequestPasswordResetService).
--
-- idx_password_reset_tokens_identity_created serve o teto de pedidos
-- por Identity numa janela (contra uso do formulário para encher a
-- caixa de alguém de e-mails), sem varrer a tabela.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
-- Depende de identities (0002) já existir.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id                     BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id              CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021). NUNCA e o token.',
    identity_public_id     CHAR(36)      NOT NULL
        COMMENT 'FK para identities.public_id - titular da senha a redefinir.',
    token_hash             CHAR(64)      NOT NULL
        COMMENT 'SHA-256 (hex) do token bruto de 256 bits - o token bruto NUNCA e persistido nem logado.',
    status                 ENUM('PENDING','CONSUMED','REVOKED') NOT NULL DEFAULT 'PENDING'
        COMMENT 'EXPIRED e derivado de expires_at <= NOW(), nunca persistido.',
    correlation_id         CHAR(36)      NOT NULL,
    created_at             DATETIME(3)   NOT NULL,
    expires_at             DATETIME(3)   NOT NULL
        COMMENT 'Validade curta, padrao 30 min (PASSWORD_RESET_TTL_SECONDS); teto de 60 min no agregado.',
    consumed_at            DATETIME(3)   NULL
        COMMENT 'Carimbo de uso unico. A trava real de replay e o UPDATE ... WHERE status = PENDING AND consumed_at IS NULL.',
    revoked_at             DATETIME(3)   NULL,
    revocation_reason      VARCHAR(64)   NULL
        COMMENT 'SUPERSEDED quando um pedido novo revoga os anteriores; COMPLETED_BY_OTHER reservado.',
    PRIMARY KEY (id),
    UNIQUE KEY uk_password_reset_tokens_public_id (public_id),
    UNIQUE KEY uk_password_reset_tokens_token_hash (token_hash),
    KEY idx_password_reset_tokens_identity_status (identity_public_id, status),
    KEY idx_password_reset_tokens_identity_created (identity_public_id, created_at),
    KEY idx_password_reset_tokens_expires_at (expires_at),
    CONSTRAINT fk_password_reset_tokens_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Pedidos de redefinicao de senha pelo proprio titular - bounded context security';
