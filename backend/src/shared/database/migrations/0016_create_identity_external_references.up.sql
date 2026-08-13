-- Migration: 0016_create_identity_external_references
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: contexto de negócio P1B.0 (mapeamento portal_acesso ↔
-- Identity.publicId no Ingressa) — branch feature/identity-external-reference-v0.7.x.
--
-- Nome da tabela: `identity_external_references` (plural completo,
-- mesmo padrão de `organization_external_references`, migration 0013).
-- Tabela PARALELA a `organization_external_references` — deliberadamente
-- NÃO generalizada, não toca a tabela 0013 já homologada com dado real.
-- Mesma filosofia de "tabela paralela" aplicada ao domínio: um bounded
-- context não cruza import com o outro.
--
-- Propósito: resolver o gap real descoberto no P1A.1 — o Portal não tem
-- como saber qual Identity.publicId do Ingressa corresponde a um usuário
-- logado (req.user.id = portal_acesso.id). E-mail não pode ser usado
-- como chave permanente: caso real confirmado (Identity arlei.pizarro@
-- pctec.com.br vs portal_acesso.id=33 com arlei@pizarros.com.br são a
-- MESMA PESSOA com e-mails diferentes). A solução é persistir o vínculo
-- explícito aqui.
--
-- system_code: mesmo ENUM fechado de 0013 — PCTEC_HUB, PCTEC_HELPDESK,
-- PCTEC_PORTAL. Nenhum sistema fictício adicionado.
--
-- entity_type: VARCHAR aberto (não ENUM), mesma decisão de 0013 —
-- cada sistema legado tem nomes de tabela próprios e incompatíveis.
-- Limite 64 caracteres, alinhado à coluna análoga de 0013.
--
-- legacy_id: BIGINT, id local do sistema legado (portal_acesso.id,
-- por exemplo). NUNCA um contrato cross-system — só rastreabilidade.
-- O único identificador cross-system é Identity.publicId (este bounded
-- context).
--
-- status: mesmo ENUM('ACTIVE','SUPERSEDED') de 0013. Uma referência
-- é marcada SUPERSEDED (nunca deletada) quando corrigida.
--
-- match_method: ENUM('MATCHED_BY_EMAIL','MATCHED_MANUAL_CONFIRMED') —
-- campo novo, sem precedente em 0013. Fechado a exatamente esses 2
-- valores (UNMATCHED/AMBIGUOUS/INVALID_EMAIL são resultados de processo
-- de bootstrap, nunca persistidos — só uma referência que JÁ passou pelo
-- processo e foi confirmada é inserida aqui). Quem decide o método é
-- sempre o chamador (CLI, Fatia 3) — nunca inferido automaticamente
-- pelo service.
--
-- active_match_key: coluna VIRTUAL gerada, mesma técnica de 0013.
-- NULL quando status != 'ACTIVE'; CONCAT(system_code, ':', entity_type,
-- ':', legacy_id) quando ACTIVE. UNIQUE KEY sobre ela garante, no
-- próprio banco e sem janela de corrida (TOCTOU), no máximo 1 referência
-- ACTIVE por (system_code, entity_type, legacy_id). Ver raciocínio
-- completo de concorrência em 0013 — mesma lógica aplicada aqui.
--
-- FK: identity_public_id -> identities.public_id, ON DELETE RESTRICT
-- ON UPDATE RESTRICT (mesma convenção de 0006/0011/0012/0013).
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

CREATE TABLE IF NOT EXISTS identity_external_references (
    id                        BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id                 CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021). Identidade própria desta entidade de integração — não confundir com identity_public_id.',
    identity_public_id        CHAR(36)      NOT NULL
        COMMENT 'FK para identities.public_id. Contrato cross-system oficial — legacy_id nunca substitui isto.',
    system_code               ENUM('PCTEC_HUB','PCTEC_HELPDESK','PCTEC_PORTAL') NOT NULL
        COMMENT 'Sistema legado de origem. Fechado — só os 3 sistemas canônicos confirmados contra o design.',
    entity_type               VARCHAR(64)   NOT NULL
        COMMENT 'Nome da tabela/entidade de origem no sistema legado (ex.: portal_acesso, clientes) — aberto por sistema.',
    legacy_id                 BIGINT        NOT NULL
        COMMENT 'id local do sistema legado (ex.: portal_acesso.id). NUNCA um identificador cross-system — só rastreabilidade.',
    status                    ENUM('ACTIVE','SUPERSEDED') NOT NULL DEFAULT 'ACTIVE'
        COMMENT 'SUPERSEDED quando substituída por correção de matching — nunca deletada (rastreabilidade histórica).',
    match_method              ENUM('MATCHED_BY_EMAIL','MATCHED_MANUAL_CONFIRMED') NOT NULL
        COMMENT 'Como o vínculo foi confirmado. Fechado a 2 valores — só referências já confirmadas são persistidas. Nunca inferido pelo service: quem decide é sempre o chamador (CLI).',
    active_match_key          VARCHAR(154)  GENERATED ALWAYS AS (
        CASE WHEN status = 'ACTIVE' THEN CONCAT(system_code, ':', entity_type, ':', legacy_id) ELSE NULL END
    ) VIRTUAL
        COMMENT 'Coluna gerada, uso exclusivo de uk_id_ext_ref_active_match abaixo — nunca lida/gravada diretamente pela aplicação. NULL quando status != ACTIVE.',
    created_at                DATETIME(3)   NOT NULL,
    updated_at                DATETIME(3)   NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_id_ext_ref_public_id (public_id),
    UNIQUE KEY uk_id_ext_ref_active_match (active_match_key)
        COMMENT 'Garante, NO PRÓPRIO BANCO e sem janela de corrida, no máximo 1 linha ACTIVE por (system_code, entity_type, legacy_id) — InnoDB trata cada NULL como distinto em UNIQUE KEY, então linhas SUPERSEDED (active_match_key=NULL) nunca colidem entre si nem com a linha ACTIVE. Ver 0013 para o raciocínio completo sobre concorrência.',
    KEY idx_id_ext_ref_system_entity_legacy (system_code, entity_type, legacy_id)
        COMMENT 'Índice comum (não único) para consultas por todas as linhas (ACTIVE + SUPERSEDED), incluindo histórico.',
    KEY idx_id_ext_ref_identity (identity_public_id),
    CONSTRAINT fk_id_ext_ref_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Ponte de rastreabilidade Identity <-> sistemas legados (HUB/Helpdesk/Portal) - bounded context identity (P1B.0, v0.7.x)';
