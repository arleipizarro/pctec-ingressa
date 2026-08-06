-- Migration: 0003_create_audit_events
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/03-dominio/MODELO-DE-DOMINIO.md, entidade AuditEvent;
-- seção 12 do prompt de implementação desta fatia.
--
-- Tabela append-only: nenhuma UPDATE ou DELETE operacional é esperada.
-- FK para identities.id foi deliberadamente OMITIDA aqui — auditoria deve
-- sobreviver mesmo que, futuramente, uma linha de origem seja tratada de
-- forma diferente (evita acoplamento indevido entre o registro de
-- auditoria imutável e o ciclo de vida da entidade auditada).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (v0.4.0 Slice 1).

CREATE TABLE IF NOT EXISTS audit_events (
    id                     BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna, não exposta.',
    event_public_id        CHAR(36)      NOT NULL
        COMMENT 'UUID do evento (eventId), único.',
    event_type             VARCHAR(100)  NOT NULL
        COMMENT 'Ex.: identity.created.',
    event_version           SMALLINT UNSIGNED NOT NULL,
    aggregate_public_id    CHAR(36)      NOT NULL
        COMMENT 'public_id da entidade afetada (ex.: Identity.publicId).',
    actor_public_id        VARCHAR(36)   NOT NULL
        COMMENT 'public_id do actor, ou o marcador reservado SYSTEM.',
    correlation_id         CHAR(36)      NOT NULL,
    causation_id            CHAR(36)      NULL,
    payload_json            JSON          NOT NULL
        COMMENT 'Payload mínimo do evento; nunca contém CPF integral, senha, hash, token ou segredo.',
    occurred_at             DATETIME(3)   NOT NULL
        COMMENT 'Momento em que o evento de domínio ocorreu.',
    persisted_at             DATETIME(3)   NOT NULL
        COMMENT 'Momento em que o registro de auditoria foi gravado.',
    PRIMARY KEY (id),
    UNIQUE KEY uk_audit_events_event_public_id (event_public_id),
    KEY idx_audit_events_aggregate (aggregate_public_id),
    KEY idx_audit_events_type_occurred (event_type, occurred_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Registro imutável de auditoria — bounded context audit (v0.4.0 Slice 1)';
