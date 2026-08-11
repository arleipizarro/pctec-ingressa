-- Migration: 0013_create_organization_external_references
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/adr/ADR-031-ORGANIZATION-CANONICA-NO-INGRESSA.md,
-- Consequências; docs/03-dominio/ORGANIZATION-MEMBERSHIP-DESIGN.md,
-- seção 9.1.
--
-- Nome da tabela: `organization_external_references` (plural completo,
-- mesma convenção de pluralização de `organizations`/
-- `organization_relationships`) — corrige um lapso de nomenclatura dos
-- documentos anteriores, que ainda usavam `organization_external_refs`
-- em alguns trechos de prosa mesmo depois de ADR-031 já ter formalizado
-- a entidade como `OrganizationExternalReference`. Corrigido nesta
-- entrega em ADR-031 e ORGANIZATION-MEMBERSHIP-DESIGN.md (ver relatório).
--
-- Esta é a ponte de rastreabilidade entre o Ingressa e os sistemas
-- legados (HUB/Helpdesk/Portal) — identidade própria (public_id),
-- status e timestamps, não uma tabela de apoio simples.
--
-- system_code: ENUM fechado — só os 3 sistemas canônicos já confirmados
-- contra o design (§9.2): PCTEC_HUB, PCTEC_HELPDESK, PCTEC_PORTAL.
-- Nenhum sistema fictício adicionado.
--
-- entity_type: VARCHAR aberto (não ENUM) — deliberado. Cada sistema
-- legado tem nomes de tabela próprios e incompatíveis entre si
-- (`clientes`/`clientes_grupo` no HUB, `clients` no Helpdesk, `clientes`
-- no Portal — três schemas físicos diferentes, confirmado na auditoria
-- da Fase G); fechar isso em ENUM exigiria antecipar todos os nomes de
-- tabela de 3 sistemas externos, que este bounded context não deveria
-- precisar conhecer em detalhe. Validado apenas como string não vazia.
--
-- legacy_id: BIGINT — id local do sistema legado, canônico (nunca
-- string formatada/pontuada). NUNCA um contrato cross-system — é
-- somente para rastreabilidade/correlação; o único identificador
-- cross-system é organization_public_id (ADR-031).
--
-- status: ENUM('ACTIVE','SUPERSEDED') — já decidido em ADR-031: uma
-- referência é marcada SUPERSEDED (nunca deletada) quando uma correção
-- de matching a substitui, preservando rastreabilidade histórica
-- completa.
--
-- Invariante — CORRIGIDA nesta migration (revisão do Product Owner,
-- antes do commit de G2, ainda dentro de G2 pois esta migration nunca
-- foi executada): a primeira versão desta migration tinha
-- `UNIQUE(system_code, entity_type, legacy_id)` cobrindo TODAS as
-- linhas, independente de status — isso está em tensão direta com
-- `SUPERSEDED`: se uma correção de matching precisar apontar o mesmo
-- registro legado para OUTRA Organization, preservando a referência
-- antiga como histórico (o próprio propósito de `SUPERSEDED`), a
-- UNIQUE global bloquearia a inserção da referência corrigida enquanto
-- a antiga (agora SUPERSEDED) ainda existir — `SUPERSEDED` ficaria
-- decorativo, nunca de fato utilizável.
--
-- SEGUNDA CORREÇÃO (mesma revisão, antes do commit de G2) — concorrência:
-- a primeira tentativa de correção resolvia isso movendo a invariante
-- inteiramente para a camada de aplicação (check-then-insert dentro da
-- transação, sem UNIQUE KEY nenhuma sobre as 3 colunas) — mas isso abre
-- uma janela real de corrida (TOCTOU): duas transações concorrentes
-- podem cada uma consultar "existe ACTIVE?" (não), e cada uma inserir
-- uma linha ACTIVE, resultando em duas ACTIVE para a mesma chave lógica
-- — exatamente o que a invariante deveria impedir.
--
-- Opções avaliadas para eliminar a janela de corrida:
--   1. Só camada de aplicação (check-then-insert) — REJEITADA: janela
--      TOCTOU real, unicidade deixaria de ser garantida sob concorrência.
--   2. Named lock (mesmo padrão do bootstrap administrativo,
--      BootstrapFirstApplicationAccessService) — descartada aqui: named
--      lock é para um guard one-shot processual (um evento único na vida
--      da plataforma), não para uma invariante de dado recorrente que se
--      repete a cada correção de matching; serializaria toda escrita
--      nesta tabela globalmente, custo desproporcional ao problema.
--   3. Isolamento de transação mais forte (SERIALIZABLE) só para esta
--      tabela — descartada: mudaria o nível de isolamento do restante
--      da transação (não há como isolar só uma tabela), efeito colateral
--      amplo demais para uma correção pontual.
--   4. **Coluna gerada (VIRTUAL) + UNIQUE KEY condicional — ESCOLHIDA.**
--      `active_match_key` é `NULL` quando `status != 'ACTIVE'`, e
--      `CONCAT(system_code, ':', entity_type, ':', legacy_id)` quando
--      `status = 'ACTIVE'`. MariaDB/InnoDB trata cada `NULL` como
--      DISTINTO dentro de uma `UNIQUE KEY` (comportamento padrão SQL) —
--      então múltiplas linhas `SUPERSEDED` (todas com
--      `active_match_key = NULL`) nunca colidem entre si, mas duas
--      linhas tentando ser `ACTIVE` para a MESMA chave lógica colidem
--      sempre, garantido PELO PRÓPRIO BANCO, atomicamente, sem qualquer
--      janela de corrida — o InnoDB rejeita o segundo INSERT concorrente
--      com um erro de chave duplicada real, não uma checagem otimista da
--      aplicação. A camada de aplicação
--      (`existsActiveBySystemCodeEntityTypeAndLegacyId`, no
--      repository) continua existindo, mas agora só como FAST FAIL para
--      uma mensagem de erro de domínio amigável no caso comum
--      (`OrganizationExternalReferenceAlreadyExistsError`) — a garantia
--      real de correção sob concorrência é a `UNIQUE KEY` sobre a coluna
--      gerada; se a checagem otimista perder a corrida, o INSERT ainda
--      falha no banco, e a camada de infraestrutura traduz esse erro de
--      volta para o mesmo erro de domínio (ver
--      `MariaDbOrganizationExternalReferenceRepository.insert()`).
--
-- Corrigido com um princípio ADJACENTE ao já usado por
-- `application_accesses` (migration 0006: "um índice único condicional
-- ... não é nativo no MariaDB sem coluna gerada — não improvisado aqui")
-- — mas, diferente de 0006 (que optou por NÃO improvisar a coluna
-- gerada naquele momento, usando named lock só para o guard one-shot do
-- bootstrap), aqui a coluna gerada É o caminho certo: a invariante
-- "no máximo 1 ACTIVE" se repete a cada correção de matching (não é um
-- evento único de bootstrap), então vale o custo de manutenção de uma
-- coluna gerada em troca de correção garantida pelo banco. Retrofitar
-- 0006 com a mesma técnica fica fora de escopo desta entrega (G2 não
-- deve tocar migrations anteriores já aplicadas no DEV).
--
-- FK: organization_public_id -> organizations.public_id, ON DELETE
-- RESTRICT ON UPDATE RESTRICT (mesma convenção de 0006/0011/0012).
--
-- Sem `version` nesta fatia: G2 não implementa nenhum comando de
-- mutação sobre uma OrganizationExternalReference existente (só
-- CreateOrganizationExternalReferenceService) — marcar SUPERSEDED fica
-- para quando o processo de correção de matching for implementado
-- (fora de escopo G2, gap registrado no relatório).
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (G2 — v0.6.x).

CREATE TABLE IF NOT EXISTS organization_external_references (
    id                        BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id                 CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021). Identidade própria desta entidade de integração — não confundir com organization_public_id.',
    organization_public_id    CHAR(36)      NOT NULL
        COMMENT 'FK para organizations.public_id. Contrato cross-system oficial (ADR-031) — legacy_id nunca substitui isto.',
    system_code                ENUM('PCTEC_HUB','PCTEC_HELPDESK','PCTEC_PORTAL') NOT NULL
        COMMENT 'Sistema legado de origem. Fechado — só os 3 sistemas canônicos confirmados contra o design.',
    entity_type                VARCHAR(64)   NOT NULL
        COMMENT 'Nome da tabela/entidade de origem no sistema legado (ex.: clientes, clientes_grupo, clients) — aberto por sistema, ver comentário do arquivo.',
    legacy_id                  BIGINT        NOT NULL
        COMMENT 'id local do sistema legado. NUNCA um identificador cross-system — só rastreabilidade/correlação (ADR-031).',
    status                     ENUM('ACTIVE','SUPERSEDED') NOT NULL DEFAULT 'ACTIVE'
        COMMENT 'SUPERSEDED quando substituída por correção de matching — nunca deletada (rastreabilidade histórica, ADR-031).',
    active_match_key            VARCHAR(154)  GENERATED ALWAYS AS (
        CASE WHEN status = 'ACTIVE' THEN CONCAT(system_code, ':', entity_type, ':', legacy_id) ELSE NULL END
    ) VIRTUAL
        COMMENT 'Coluna gerada, uso exclusivo de uk_org_ext_ref_active_match abaixo — nunca lida/gravada diretamente pela aplicação. NULL quando status != ACTIVE.',
    created_at                 DATETIME(3)   NOT NULL,
    updated_at                 DATETIME(3)   NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_org_ext_ref_public_id (public_id),
    UNIQUE KEY uk_org_ext_ref_active_match (active_match_key)
        COMMENT 'Garante, NO PRÓPRIO BANCO e sem janela de corrida, no máximo 1 linha ACTIVE por (system_code, entity_type, legacy_id) — InnoDB trata cada NULL como distinto em UNIQUE KEY, então linhas SUPERSEDED (active_match_key=NULL) nunca colidem entre si nem com a linha ACTIVE. Ver comentário do arquivo para o raciocínio completo sobre concorrência.',
    KEY idx_org_ext_ref_system_entity_legacy (system_code, entity_type, legacy_id)
        COMMENT 'Índice comum (não único) para consultas por todas as linhas (ACTIVE + SUPERSEDED), incluindo histórico — a invariante de unicidade em si é a UNIQUE KEY acima, sobre active_match_key.',
    KEY idx_org_ext_ref_organization (organization_public_id),
    CONSTRAINT fk_org_ext_ref_organization
        FOREIGN KEY (organization_public_id) REFERENCES organizations (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Ponte de rastreabilidade Organization <-> sistemas legados (HUB/Helpdesk/Portal) - bounded context organization (G2, v0.6.x, ADR-031)';
