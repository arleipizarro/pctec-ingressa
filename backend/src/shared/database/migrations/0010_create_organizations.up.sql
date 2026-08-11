-- Migration: 0010_create_organizations
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/adr/ADR-031-ORGANIZATION-CANONICA-NO-INGRESSA.md;
-- docs/03-dominio/ORGANIZATION-MEMBERSHIP-DESIGN.md, seção 1-2;
-- docs/03-dominio/MODELO-DE-DOMINIO.md, seção 3;
-- docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md, seção 3 (v0.2.0,
-- revisada nesta migration); ADR-021 (id interno BIGINT + public_id
-- CHAR(36)); ADR-024 (version / optimistic locking).
--
-- Convenção de nomenclatura (ADR-021, mesma já aplicada em `identities`
-- desde v0.4.0 e `applications`/`application_accesses` desde v0.5.0):
-- `id` é a chave interna (BIGINT), nunca exposta fora do banco;
-- `public_id` é o identificador externo (UUID textual, CHAR(36)),
-- imutável. Diverge deliberadamente da convenção de
-- MODELO-RELACIONAL-PROPOSTO.md v0.2.0 (`internal_id` + `id BINARY(16)`)
-- pelo mesmo motivo já registrado em ADR-021 na migration 0005 —
-- convergência de nomenclatura tratada tabela a tabela conforme cada
-- uma é efetivamente implementada.
--
-- G1 — Organization Foundation (Fase G): esta migration cria SOMENTE a
-- tabela `organizations`. `organization_relationships` está na próxima
-- migration (0011). `memberships` e `organization_external_references`
-- ficam para G2, fora do escopo desta entrega.
--
-- document_number: nullable para AMBOS os tipos (`BUSINESS_GROUP` pode
-- não ter CNPJ próprio; `COMPANY` pode ter). Unicidade condicionada ao
-- par (document_number, type), permitindo múltiplos NULL — um
-- `BUSINESS_GROUP` nunca deve ter CNPJ herdado artificialmente de uma
-- `COMPANY` filha; essa é uma regra de processo/serviço, não expressável
-- como constraint de banco.
--
-- Sem colunas created_by/updated_by_identity_public_id nesta tabela —
-- deliberado: o campo "quem criou" já fica registrado no evento de
-- domínio `organization.created` (audit_events.actor_public_id), e o
-- conjunto de colunas foi mantido estritamente igual ao aprovado pelo
-- Product Owner para esta entrega (internalId, publicId, type,
-- legalName, tradeName, documentNumber, status, version, createdAt,
-- updatedAt) — divergência a registrar no relatório desta entrega, não
-- decidida silenciosamente.
--
-- Exatamente UMA instrução executável neste arquivo (MigrationRunner
-- exige isso — ver assertSingleStatement).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (G1 — v0.6.x).

CREATE TABLE IF NOT EXISTS organizations (
    id                     BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna. NUNCA exposta em API, evento, log de consumidor ou token (ADR-021).',
    public_id              CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutável, identificador externo (ADR-021). Único identificador cross-system aceito (ADR-031).',
    type                   ENUM('BUSINESS_GROUP','COMPANY') NOT NULL
        COMMENT 'BUSINESS_GROUP = grupo empresarial (pode conter COMPANY via organization_relationships); COMPANY = empresa individual.',
    legal_name             VARCHAR(255)  NOT NULL
        COMMENT 'Razão social (COMPANY) ou nome oficial do grupo (BUSINESS_GROUP).',
    trade_name              VARCHAR(255)  NULL
        COMMENT 'Nome fantasia. Opcional.',
    document_number        VARCHAR(20)   NULL
        COMMENT 'CNPJ normalizado (somente dígitos). Nome de coluna genérico por convenção de MODELO-RELACIONAL-PROPOSTO.md, mas o contrato real desta fatia é especificamente CNPJ (ver DocumentNumber.ts) — não um documento genérico. Opcional para AMBOS os tipos — BUSINESS_GROUP frequentemente não possui CNPJ próprio; nunca herdado de COMPANY filha (regra de processo, não de banco).',
    status                 ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    version                BIGINT UNSIGNED NOT NULL DEFAULT 1
        COMMENT 'Controle de concorrência otimista (ADR-024) — reservado; sem comando de mutação nesta fatia (G1 só implementa CreateOrganization).',
    created_at              DATETIME(3)   NOT NULL,
    updated_at              DATETIME(3)   NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_organizations_public_id (public_id),
    UNIQUE KEY uk_organizations_document_type (document_number, type)
        COMMENT 'Unicidade condicionada ao tipo; permite múltiplos NULL (MariaDB trata cada NULL como distinto em UNIQUE KEY).',
    KEY idx_organizations_type_status (type, status)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Cadastro Mestre canônico de organizações (grupos e empresas) do ecossistema PCTEC - bounded context organization (G1, v0.6.x, ADR-031)';
