-- Migration: 0032_create_delegation_assertions
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Asserções de delegação: prova, emitida pelo Ingressa, de que UMA
-- identidade autorizada pediu, por meio de UM produto (emissor), UMA
-- ação específica em OUTRO sistema (destinatário). Primeiro uso: a
-- Central de Serviços pede notas no Helpdesk em nome do operador.
--
-- Por que opaca e guardada aqui, e não um token assinado: o destinatário
-- sempre pergunta ao Ingressa, que (1) confere a identidade AINDA
-- autorizada no momento do uso, (2) consome a asserção uma única vez e
-- (3) permite revogação imediata — nada disso um token autocontido dá.
--
-- Só o SHA-256 do token é guardado; o token em si nunca é persistido.
-- A amarração (destinatário, chamado, chave, tipo, hash do conteúdo,
-- validade) é o que impede o reaproveitamento para outra ação.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).

CREATE TABLE IF NOT EXISTS delegation_assertions (
    id                            BIGINT UNSIGNED AUTO_INCREMENT COMMENT 'Chave interna, nunca exposta.',
    public_id                     CHAR(36)     NOT NULL COMMENT 'UUID textual, identificador externo (ADR-021).',
    token_hash                    CHAR(64)     NOT NULL COMMENT 'SHA-256 hex do token opaco. O token nunca é gravado.',
    issuer_application_public_id  CHAR(36)     NOT NULL COMMENT 'Produto que pediu a asserção em nome da pessoa (ex.: PCTEC_CENTRAL_SERVICOS).',
    audience_application_code     VARCHAR(64)  NOT NULL COMMENT 'Único sistema que pode consumir a asserção (ex.: PCTEC_HELPDESK).',
    identity_public_id            CHAR(36)     NOT NULL COMMENT 'Pessoa em nome de quem a ação é pedida.',
    ticket_id                     BIGINT UNSIGNED NOT NULL COMMENT 'Chamado do destinatário ao qual a ação se aplica.',
    idempotency_key               VARCHAR(96)  NOT NULL COMMENT 'Chave da ação no emissor; uma asserção por ação.',
    action_kind                   VARCHAR(32)  NOT NULL COMMENT 'Tipo da ação (ANDAMENTO_INTERNO, RESPOSTA_PUBLICA, RESOLUCAO).',
    content_sha256                CHAR(64)     NOT NULL COMMENT 'SHA-256 hex do conteúdo exato autorizado.',
    issued_at                     DATETIME(3)  NOT NULL,
    expires_at                    DATETIME(3)  NOT NULL,
    consumed_at                   DATETIME(3)  NULL COMMENT 'Primeiro e único uso. NULL = ainda não usada.',
    consumed_by_consumer          VARCHAR(64)  NULL COMMENT 'Consumidor autenticado que usou (auditoria).',
    PRIMARY KEY (id),
    UNIQUE KEY uk_delegation_assertions_public_id (public_id),
    UNIQUE KEY uk_delegation_assertions_token (token_hash),
    UNIQUE KEY uk_delegation_assertions_action (issuer_application_public_id, idempotency_key)
        COMMENT 'Uma asserção por ação do emissor: repetir a emissão para a mesma ação é recusado.',
    KEY idx_delegation_assertions_identity (identity_public_id),
    KEY idx_delegation_assertions_expires (expires_at),
    CONSTRAINT fk_delegation_assertions_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_delegation_assertions_issuer
        FOREIGN KEY (issuer_application_public_id) REFERENCES applications (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_delegation_assertions_validity CHECK (expires_at > issued_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Asserções de delegação de uso único, amarradas a uma ação específica';
