-- Migration: 0011_create_organization_relationships
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/adr/ADR-031-ORGANIZATION-CANONICA-NO-INGRESSA.md;
-- docs/03-dominio/ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 3;
-- docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md, seção 4 (v0.2.0,
-- revisada nesta migration).
--
-- Depende de `organizations` (0010) já existir — ordem de aplicação
-- garantida pelo prefixo numérico do arquivo.
--
-- Convenção de FK: referencia organizations.public_id (não
-- organizations.id), mesma convenção já usada por `application_accesses`
-- (migration 0006) — diverge deliberadamente de
-- MODELO-RELACIONAL-PROPOSTO.md v0.2.0 (que usava internal_id como alvo
-- de FK), pelo mesmo motivo já registrado em ADR-021/0005/0006:
-- convergência de nomenclatura tratada tabela a tabela.
--
-- Regras de domínio (aplicadas na camada de aplicação, não no banco —
-- MariaDB não expressa "parent deve ser BUSINESS_GROUP, child deve ser
-- COMPANY" sem trigger, e trigger não está aprovado nesta fase, mesma
-- decisão já registrada para este modelo em MODELO-RELACIONAL-PROPOSTO.md
-- seção 4):
--   - parent_organization_public_id deve referenciar uma Organization
--     do tipo BUSINESS_GROUP;
--   - child_organization_public_id deve referenciar uma Organization do
--     tipo COMPANY;
--   - sem ciclos (trivialmente garantido no MVP: apenas hierarquia de 1
--     nível, BUSINESS_GROUP -> COMPANY, nunca BUSINESS_GROUP -> BUSINESS_GROUP).
--
-- Políticas ON DELETE / ON UPDATE: RESTRICT em ambas as FKs, mesmo
-- princípio e mesma justificativa já registrada em 0006 — organizations
-- nunca sofre DELETE físico no fluxo operacional comum (soft delete via
-- status, não implementado ainda nesta fatia) e public_id é imutável;
-- RESTRICT é defesa em profundidade contra exclusão/alteração manual
-- indevida que deixaria organization_relationships órfã.
--
-- Sem coluna `status`/`updated_at` nesta fatia: G1 implementa somente
-- CreateOrganizationRelationshipService (comando de criação). Encerrar
-- um relacionamento (empresa sai do grupo) fica para uma fatia futura —
-- não decidido silenciosamente, registrado como gap no relatório desta
-- entrega.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (G1 — v0.6.x).

CREATE TABLE IF NOT EXISTS organization_relationships (
    id                                BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna, não exposta.',
    public_id                         CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021).',
    parent_organization_public_id     CHAR(36)      NOT NULL
        COMMENT 'FK para organizations.public_id — deve ser do tipo BUSINESS_GROUP (validado em application layer).',
    child_organization_public_id      CHAR(36)      NOT NULL
        COMMENT 'FK para organizations.public_id — deve ser do tipo COMPANY (validado em application layer).',
    created_at                         DATETIME(3)   NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_org_rel_public_id (public_id),
    UNIQUE KEY uk_org_rel_child (child_organization_public_id)
        COMMENT 'No MVP, uma COMPANY pertence a no máximo um BUSINESS_GROUP (ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 3).',
    KEY idx_org_rel_parent (parent_organization_public_id),
    CONSTRAINT fk_org_rel_parent
        FOREIGN KEY (parent_organization_public_id) REFERENCES organizations (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_org_rel_child
        FOREIGN KEY (child_organization_public_id) REFERENCES organizations (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Hierarquia BUSINESS_GROUP -> COMPANY - bounded context organization (G1, v0.6.x, ADR-031)';
