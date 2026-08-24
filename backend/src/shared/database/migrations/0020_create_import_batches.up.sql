-- Migration: 0020_create_import_batches
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: fundação do importador Helpdesk -> Ingressa (v0.8.x),
-- item 4 da task.
--
-- Um `import_batch` é UMA execução do importador. Nada é escrito no
-- Ingressa por importação sem um lote que o explique.
--
-- DOIS FINGERPRINTS, DOIS PAPÉIS DIFERENTES
--
-- `snapshot_fingerprint` — hash de tudo que foi LIDO da origem naquela
--   execução. Informativo/forense: responde "o que o importador viu".
--
-- `scope_fingerprint` — hash SOMENTE das entidades dentro do escopo
--   declarado do lote, dos registros necessários para resolvê-las, e da
--   `mapping_rules_version`. É ESTE que autoriza o APPLY.
--
-- A separação existe por uma razão prática: o Helpdesk tem 170 usuários
-- e recebe cadastro novo o tempo todo. Se o apply exigisse que a base
-- inteira estivesse imóvel entre o dry-run e a aprovação, nenhum lote
-- jamais seria aplicado. Um usuário criado em outro cliente, fora do
-- escopo do lote, não pode invalidar a aprovação de um lote de AFIP.
-- Já uma mudança NO ESCOPO — o e-mail de um dos usuários importados, a
-- empresa dele, a composição do grupo — muda o `scope_fingerprint` e
-- derruba o apply, que é exatamente o que se quer.
--
-- mode: DRY_RUN nunca escreve entidade de domínio; só registra o que
-- FARIA, em `import_batch_items`. APPLY referencia obrigatoriamente o
-- DRY_RUN que o originou (`dry_run_batch_public_id`) e só roda se o
-- `scope_fingerprint` for idêntico ao dele.
--
-- status: RUNNING -> COMPLETED | FAILED | ABORTED. Transições validadas
-- no domínio (ImportBatch), não por trigger.
--
-- counts_before/counts_after: JSON com a contagem por entidade antes e
-- depois. Permite o relatório antes/depois sem reprocessar nada.
--
-- SEM FK para `identities` em `approved_by_identity_public_id`: um lote
-- é registro histórico de auditoria e precisa sobreviver a qualquer
-- operação futura sobre a Identity do aprovador. Mesma decisão já
-- tomada nas colunas de ator de `audit_events`.
--
-- FAIL-CLOSED: SEM `IF NOT EXISTS`
--
-- O `CREATE TABLE` abaixo e deliberadamente NU — nunca
-- `CREATE TABLE IF NOT EXISTS`. Mesma doutrina ja registrada em 0007,
-- 0014 e 0018, e pela mesma razao: a idempotencia operacional e
-- responsabilidade do MigrationRunner (que so executa o que ainda nao
-- esta em `schema_migrations`), NUNCA do SQL.
--
-- Com `IF NOT EXISTS`, uma tabela homonima pre-existente — deixada por
-- um experimento manual, por um rollback incompleto ou por uma versao
-- anterior desta propria migration — faria o `CREATE` virar NO-OP
-- silencioso. O runner registraria 0020 como aplicada e o schema real
-- ficaria DIVERGENTE do que esta migration descreve, sem nenhum sinal.
-- Todo o resto passaria a apostar num contrato que nao existe: 0021
-- criaria sua FK contra uma `import_batches` de forma desconhecida, e o
-- importador escreveria em colunas que podem nao estar la.
--
-- Sem a clausula, o mesmo cenario aborta com ER_TABLE_EXISTS_ERROR
-- (errno 1050), 0020 NAO e registrada como aplicada, e o operador e
-- obrigado a olhar e decidir. Divergencia de estado precisa falhar
-- explicitamente — nunca ser mascarada.
--
-- O `down` mantem `DROP TABLE IF EXISTS`, e a assimetria e deliberada:
-- o `down` precisa ser tolerante porque e justamente a ferramenta de
-- saida de um estado parcial; o `up` precisa ser intolerante para nao
-- criar esse estado parcial em primeiro lugar.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

CREATE TABLE import_batches (
    id                             BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento ou log de consumidor (ADR-021).',
    public_id                      CHAR(36)     NOT NULL
        COMMENT 'UUID textual, imutavel, identificador externo do lote (ADR-021). E o batchId citado em aprovacao, relatorio e rollback.',
    source_system                  ENUM('PCTEC_HUB','PCTEC_HELPDESK','PCTEC_PORTAL') NOT NULL
        COMMENT 'Sistema legado de origem. Mesmo ENUM fechado de 0013/0016 - nenhum sistema ficticio.',
    mapping_rules_version          VARCHAR(32)  NOT NULL
        COMMENT 'Versao das REGRAS de mapeamento aplicadas (ex.: helpdesk-v1). Versiona a decisao de negocio, nao o codigo: a regra "client_group_id e classificacao, nao concessao" e desta versao. Se o Helpdesk implementar acesso de grupo de verdade, sobe para v2 e os lotes antigos continuam explicaveis.',
    snapshot_fingerprint           CHAR(64)     NOT NULL
        COMMENT 'SHA-256 de TUDO que foi lido da origem. Informativo/forense - nao gate do apply.',
    scope_fingerprint              CHAR(64)     NOT NULL
        COMMENT 'SHA-256 apenas do escopo do lote + registros de resolucao + mapping_rules_version. E ESTE que autoriza o APPLY. Mudanca fora do escopo nao o altera.',
    mode                           ENUM('DRY_RUN','APPLY') NOT NULL
        COMMENT 'DRY_RUN nunca escreve entidade de dominio. APPLY exige dry_run_batch_public_id com scope_fingerprint identico.',
    status                         ENUM('RUNNING','COMPLETED','FAILED','ABORTED') NOT NULL DEFAULT 'RUNNING'
        COMMENT 'Ciclo de vida do lote. Transicoes validadas no dominio (ImportBatch), nunca por trigger.',
    dry_run_batch_public_id        CHAR(36)     NULL
        COMMENT 'Somente em mode=APPLY: public_id do DRY_RUN COMPLETED que originou este apply. NULL em DRY_RUN.',
    approved_by_identity_public_id CHAR(36)     NULL
        COMMENT 'Identity que aprovou o apply. Sem FK de proposito: o lote e registro historico e sobrevive a operacoes futuras sobre a Identity do aprovador.',
    approved_at                    DATETIME(3)  NULL
        COMMENT 'Quando a aprovacao foi registrada. Aprovar um scope_fingerprint nunca autoriza outro.',
    counts_before                  JSON         NOT NULL
        COMMENT 'Contagem por entidade ANTES da execucao. Somente numeros agregados - nunca dado pessoal.',
    counts_after                   JSON         NULL
        COMMENT 'Contagem por entidade DEPOIS. NULL enquanto RUNNING.',
    failure_reason                 VARCHAR(500) NULL
        COMMENT 'Motivo sanitizado da falha ou do cancelamento. Nunca stack trace, credencial, payload de origem ou dado sensivel.',
    started_at                     DATETIME(3)  NOT NULL,
    finished_at                    DATETIME(3)  NULL,
    created_at                     DATETIME(3)  NOT NULL,
    updated_at                     DATETIME(3)  NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_import_batches_public_id (public_id),
    KEY idx_import_batches_source_status (source_system, status),
    KEY idx_import_batches_scope_fingerprint (scope_fingerprint),
    KEY idx_import_batches_dry_run (dry_run_batch_public_id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Execucoes do importador de sistemas legados - uma linha por dry-run ou apply (v0.8.x)';
