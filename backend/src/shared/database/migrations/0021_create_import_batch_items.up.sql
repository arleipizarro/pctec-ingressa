-- Migration: 0021_create_import_batch_items
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: fundação do importador Helpdesk -> Ingressa (v0.8.x),
-- item 4 da task.
--
-- Uma linha por DECISÃO do importador sobre um registro de origem. Em
-- DRY_RUN a linha descreve o que SERIA feito; em APPLY, o que foi feito.
-- É a trilha que sustenta o relatório antes/depois, a quarentena, a
-- retomada e o rollback por compensação.
--
-- action:
--   CREATE     - entidade nova seria/foi criada
--   UPDATE     - entidade existente seria/foi atualizada
--   SKIP       - já estava no estado desejado (idempotência)
--   CONFLICT   - origem e destino divergem de forma que exige decisão
--   QUARANTINE - ambiguidade; fail-closed, nunca palpite
--
-- reason_code: código estável e legível por máquina
-- (EMAIL_MATCHES_EXISTING_IDENTITY, ORPHAN_CLIENT_ID,
-- NO_COMMERCIAL_COUNTERPART, DENYLISTED_IDENTITY, ...). Nunca texto livre
-- — texto livre vai em `error_message`, já sanitizado.
--
-- O QUE NUNCA ENTRA EM before_snapshot / after_snapshot
--
-- Senha, hash, token, reset token, segredo, e o registro bruto completo
-- da origem. Os snapshots carregam uma WHITELIST explícita de campos,
-- montada campo a campo no domínio (ImportBatchItemSnapshot) — nunca por
-- spread do registro de origem. A tabela `users` do Helpdesk tem
-- `password`, `reset_token` e `reset_expires` na mesma linha dos dados
-- de cadastro: um spread traria os três junto.
--
-- Essa disciplina não é teórica aqui. No Portal, `agregarPorTipo` só não
-- vazou id legado para o JSON porque monta objeto novo em vez de
-- espalhar o item de origem. Mesmo princípio, mesma razão.
--
-- SEM UNIQUE em (batch, entity_kind, source_entity_type, source_legacy_id):
-- um mesmo registro de origem pode legitimamente gerar mais de um item no
-- mesmo lote (ex.: um `users` produz IDENTITY, IDENTITY_EXTERNAL_REFERENCE,
-- MEMBERSHIP e APPLICATION_ACCESS). A idempotência do importador vem das
-- UNIQUE KEYs das tabelas de destino (active_match_key, uk_membership_unique,
-- uk_app_access_active_grant), não desta trilha.
--
-- FAIL-CLOSED: SEM `IF NOT EXISTS`
--
-- O `CREATE TABLE` abaixo e deliberadamente NU — nunca
-- `CREATE TABLE IF NOT EXISTS`. Mesma doutrina de 0018 e 0020: a
-- idempotencia operacional e do MigrationRunner (que so executa o que
-- ainda nao esta em `schema_migrations`), NUNCA do SQL.
--
-- O risco aqui e ainda mais concreto que em 0020, porque esta tabela
-- carrega a trilha de auditoria do importador. Com `IF NOT EXISTS`, uma
-- `import_batch_items` homonima pre-existente faria o `CREATE` virar
-- NO-OP silencioso, 0021 seria registrada como aplicada, e a tabela
-- poderia ficar SEM `fk_ibi_batch`, sem `uk_import_batch_items_public_id`
-- ou com uma whitelist de colunas diferente da declarada aqui. A
-- consequencia nao e um erro visivel: e uma trilha de auditoria que
-- parece intacta e nao e.
--
-- Sem a clausula, o mesmo cenario aborta com ER_TABLE_EXISTS_ERROR
-- (errno 1050), 0021 NAO e registrada como aplicada, e o operador e
-- obrigado a olhar e decidir.
--
-- O `down` mantem `DROP TABLE IF EXISTS` — assimetria deliberada, pela
-- mesma razao explicada em 0020.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

CREATE TABLE import_batch_items (
    id                 BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API ou log de consumidor (ADR-021).',
    public_id          CHAR(36)     NOT NULL
        COMMENT 'UUID textual do item - permite referenciar uma decisao especifica na revisao de quarentena.',
    batch_public_id    CHAR(36)     NOT NULL
        COMMENT 'FK para import_batches.public_id. Delimita o rollback: compensar um lote e compensar seus itens.',
    entity_kind        ENUM('ORGANIZATION','ORGANIZATION_RELATIONSHIP','ORGANIZATION_EXTERNAL_REFERENCE','IDENTITY','IDENTITY_EXTERNAL_REFERENCE','MEMBERSHIP','APPLICATION_ACCESS') NOT NULL
        COMMENT 'Entidade de DESTINO no Ingressa afetada por esta decisao.',
    source_entity_type VARCHAR(64)  NOT NULL
        COMMENT 'Entidade de ORIGEM no sistema legado (users, clients, clientes_grupo...). VARCHAR aberto, mesma decisao de 0013/0016.',
    source_legacy_id   BIGINT       NOT NULL
        COMMENT 'id local do registro de origem. Rastreabilidade - nunca contrato cross-system.',
    action             ENUM('CREATE','UPDATE','SKIP','CONFLICT','QUARANTINE') NOT NULL
        COMMENT 'Decisao do importador. QUARANTINE e fail-closed: ambiguidade nunca vira palpite.',
    target_public_id   CHAR(36)     NULL
        COMMENT 'public_id da entidade de destino criada/atualizada. NULL em SKIP sem alvo, CONFLICT e QUARANTINE.',
    before_snapshot    JSON         NULL
        COMMENT 'Estado ANTES, com whitelist explicita de campos. NUNCA senha, hash, token, segredo ou registro bruto da origem.',
    after_snapshot     JSON         NULL
        COMMENT 'Estado DEPOIS (ou o que seria, em DRY_RUN), mesma whitelist.',
    reason_code        VARCHAR(64)  NULL
        COMMENT 'Codigo estavel e legivel por maquina do motivo (EMAIL_MATCHES_EXISTING_IDENTITY, ORPHAN_CLIENT_ID...). Nunca texto livre.',
    error_message      VARCHAR(500) NULL
        COMMENT 'Mensagem sanitizada. Nunca stack trace, credencial ou payload de origem.',
    created_at         DATETIME(3)  NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_import_batch_items_public_id (public_id),
    KEY idx_ibi_batch_action (batch_public_id, action),
    KEY idx_ibi_batch_kind (batch_public_id, entity_kind),
    KEY idx_ibi_source (source_entity_type, source_legacy_id),
    KEY idx_ibi_target (target_public_id),
    CONSTRAINT fk_ibi_batch
        FOREIGN KEY (batch_public_id) REFERENCES import_batches (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Decisoes individuais de um import_batch - trilha de auditoria, quarentena e compensacao (v0.8.x)';
