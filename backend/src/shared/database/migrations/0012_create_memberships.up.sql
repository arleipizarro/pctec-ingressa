-- Migration: 0012_create_memberships
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/adr/ADR-031-ORGANIZATION-CANONICA-NO-INGRESSA.md;
-- docs/03-dominio/ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 4 (e 4.1);
-- docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md, seção 5 (v0.2.0,
-- revisada nesta migration); ADR-025 (profile como classificação
-- relacional, nunca IdentityProfile); ADR-021 (id interno BIGINT +
-- public_id CHAR(36)); ADR-024 (version / optimistic locking).
--
-- G2 — Membership + OrganizationExternalReference (Fase G): esta
-- migration cria SOMENTE `memberships`. `organization_external_references`
-- está na próxima (0013).
--
-- Convenção de FK: referencia identities.public_id e
-- organizations.public_id (não *_internal_id) — mesma convenção já usada
-- por application_accesses (0006) e organization_relationships (0011),
-- diverge deliberadamente de MODELO-RELACIONAL-PROPOSTO.md v0.2.0 (que
-- usava identity_internal_id/organization_internal_id como FK), mesmo
-- motivo já registrado em ADR-021/0005/0006/0011.
--
-- profile: ENUM fechado, só os 5 valores já formalizados em ADR-025 e
-- reconfirmados em ORGANIZATION-MEMBERSHIP-DESIGN.md §4 — nenhum valor
-- novo introduzido nesta migration.
--
-- scope: ENUM fechado, só os 2 valores já formalizados em
-- ORGANIZATION-MEMBERSHIP-DESIGN.md §4 (nomes completos
-- ORGANIZATION_ONLY/ORGANIZATION_AND_DESCENDANTS — não abreviados).
--
-- status/started_at/ended_at: lifecycle mínimo já decidido no design
-- (§4: "revogação é encerrar o Membership (ended_at), não deletar").
-- version: presente por consistência com ADR-024 e com o precedente já
-- estabelecido em Organization/OrganizationRelationship (G1) — SEM
-- nenhum comando de mutação nesta fatia (G2 só implementa
-- CreateMembershipService); reservado para quando um comando de
-- revogação/alteração for aprovado.
--
-- uk_membership_unique: garante NO MÁXIMO UMA linha por classificação
-- (identity, organization, profile) — para SEMPRE, independente de
-- status. Decisão arquitetural fechada (revisão do Product Owner, antes
-- do commit de G2): um Membership encerrado (status=INACTIVE,
-- ended_at preenchido) e depois REATIVADO reutiliza a MESMA linha —
-- nunca uma segunda linha para a mesma (identity, organization,
-- profile). O comando futuro de reativação (fora de escopo G2) muda
-- status/started_at/ended_at/version na linha existente, mesmo
-- princípio já usado por `Identity` (uma única linha, transições de
-- status via comando, histórico via audit_events — nunca uma segunda
-- linha "reencarnando" a mesma pessoa). Por isso uk_membership_unique
-- é INTENCIONALMENTE não condicionada a status: há sempre exatamente
-- uma linha possível por classificação, então a constraint nunca
-- colide com o lifecycle planejado — nenhuma migration futura precisa
-- alterar esta constraint para viabilizar reativação.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (G2 — v0.6.x).

CREATE TABLE IF NOT EXISTS memberships (
    id                       BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id                CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021).',
    identity_public_id       CHAR(36)      NOT NULL
        COMMENT 'FK para identities.public_id — vínculo referencia Identity diretamente (mesmo princípio de application_accesses, ADR-025).',
    organization_public_id   CHAR(36)      NOT NULL
        COMMENT 'FK para organizations.public_id.',
    profile                  ENUM('EMPLOYEE','CUSTOMER','PARTNER','SUPPLIER','SERVICE_ACCOUNT') NOT NULL
        COMMENT 'Classificação RELACIONAL do vínculo (ADR-025; ORGANIZATION-MEMBERSHIP-DESIGN.md §4.1) — nunca autorização funcional. Novos valores exigem ALTER TABLE futuro, deliberado.',
    scope                    ENUM('ORGANIZATION_ONLY','ORGANIZATION_AND_DESCENDANTS') NOT NULL
        COMMENT 'ORGANIZATION_ONLY = só a própria Organization; ORGANIZATION_AND_DESCENDANTS = inclui COMPANY(s) descendente(s), se a Organization for BUSINESS_GROUP. Scope não é role e não define operações.',
    status                    ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    started_at                DATETIME(3)   NOT NULL
        COMMENT 'Início do vínculo — igual a created_at na criação, mas semanticamente distinto (permitiria vínculo com início futuro em fatia posterior).',
    ended_at                  DATETIME(3)   NULL
        COMMENT 'Preenchido quando o vínculo é encerrado (revogação = encerrar, nunca DELETE físico). NULL enquanto o vínculo está utilizável.',
    version                   BIGINT UNSIGNED NOT NULL DEFAULT 1
        COMMENT 'Controle de concorrência otimista (ADR-024) — reservado; sem comando de mutação nesta fatia (G2 só implementa CreateMembership).',
    created_at                DATETIME(3)   NOT NULL,
    updated_at                DATETIME(3)   NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_memberships_public_id (public_id),
    UNIQUE KEY uk_membership_unique (identity_public_id, organization_public_id, profile)
        COMMENT 'Garante no máximo 1 linha por classificação, para sempre — reativação futura reusa a mesma linha, nunca cria uma segunda (decisão fechada, ver comentário do arquivo).',
    KEY idx_memberships_identity (identity_public_id),
    KEY idx_memberships_organization (organization_public_id),
    CONSTRAINT fk_memberships_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_memberships_organization
        FOREIGN KEY (organization_public_id) REFERENCES organizations (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Vinculo Identity <-> Organization - bounded context organization (G2, v0.6.x, ADR-031)';
