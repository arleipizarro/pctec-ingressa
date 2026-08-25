-- Migration: 0022_create_sso_authorization_codes
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/adr/ADR-030 (Sessão e Autenticação); ADR-021 (id
-- interno BIGINT + public_id CHAR(36)); ADR-031 §1 (cada produto
-- consumidor tem Application própria).
--
-- Authorization Code Flow first-party com PKCE (v1.0 — SSO Ingressa →
-- PCTEC_PORTAL). Uma linha por código emitido.
--
-- code_hash CHAR(64): SHA-256 (hex) do código bruto de 256 bits — o
-- código bruto NUNCA é persistido, mesmo princípio já aplicado a
-- sessions.token_hash (0009). O código só existe em claro dentro da
-- resposta HTTP de redirect e da requisição de troca.
--
-- audience (a quem o código se destina) é modelada como FK para
-- applications.public_id — nunca uma string livre de client_id. O
-- código é emitido PARA uma Application do catálogo, e a checagem de
-- Application ACTIVE na troca usa a mesma entidade que o resto da
-- plataforma.
--
-- Sem coluna `version`: este agregado não sofre UPDATE concorrente de
-- múltiplos campos. O único UPDATE possível é o consumo, e a trava de
-- uso único é a própria condição `consumed_at IS NULL` dentro do
-- UPDATE atômico — optimistic locking por version seria uma segunda
-- trava redundante sobre a mesma linha.
--
-- Sem coluna para `state`: `state` pertence ao CLIENTE (o Portal), que
-- o compara com o valor que ele mesmo guardou. O Ingressa só o devolve
-- inalterado no redirect; persistí-lo aqui não acrescentaria nenhuma
-- verificação que o Ingressa possa fazer sozinho.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
-- Depende de identities (0002) e applications (0005) já existirem.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

CREATE TABLE IF NOT EXISTS sso_authorization_codes (
    id                     BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id              CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021). NUNCA e o codigo.',
    code_hash              CHAR(64)      NOT NULL
        COMMENT 'SHA-256 (hex) do codigo bruto de 256 bits - o codigo bruto NUNCA e persistido.',
    identity_public_id     CHAR(36)      NOT NULL
        COMMENT 'FK para identities.public_id - a quem o codigo se refere.',
    audience_application_public_id CHAR(36) NOT NULL
        COMMENT 'FK para applications.public_id - a Application para a qual o codigo foi emitido (audience). Um codigo emitido para PCTEC_PORTAL nunca vale para outra aplicacao.',
    redirect_uri           VARCHAR(512)  NOT NULL
        COMMENT 'redirect_uri EXATO usado na emissao - comparado por igualdade exata na troca, nunca por prefixo.',
    code_challenge         VARCHAR(128)  NOT NULL
        COMMENT 'PKCE code_challenge (base64url do SHA-256 do verifier). O verifier NUNCA e persistido nem trafega no redirect.',
    code_challenge_method  ENUM('S256')  NOT NULL
        COMMENT 'Somente S256 - plain avaliado e recusado por construcao (enum fechado no banco).',
    correlation_id         CHAR(36)      NOT NULL
        COMMENT 'Identificador de correlacao propagado da emissao ate a troca - devolvido ao Portal para rastreio fim-a-fim.',
    created_at             DATETIME(3)   NOT NULL,
    expires_at             DATETIME(3)   NOT NULL
        COMMENT 'Expiracao absoluta e curta (maximo 60s, aplicado em codigo). EXPIRED e estado DERIVADO, nunca persistido.',
    consumed_at            DATETIME(3)   NULL
        COMMENT 'Carimbo de uso unico. A trava real de replay e o UPDATE ... WHERE consumed_at IS NULL, nao uma leitura previa.',
    PRIMARY KEY (id),
    UNIQUE KEY uk_sso_auth_codes_public_id (public_id),
    UNIQUE KEY uk_sso_auth_codes_code_hash (code_hash),
    KEY idx_sso_auth_codes_identity (identity_public_id, expires_at),
    KEY idx_sso_auth_codes_expires_at (expires_at),
    CONSTRAINT fk_sso_auth_codes_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_sso_auth_codes_audience
        FOREIGN KEY (audience_application_public_id) REFERENCES applications (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Codigos de autorizacao do SSO first-party (PKCE S256) - bounded context security (v1.0)';
