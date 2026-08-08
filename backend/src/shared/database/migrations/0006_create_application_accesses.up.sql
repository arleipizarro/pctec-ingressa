-- Migration: 0006_create_application_accesses
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: docs/03-dominio/MODELO-DE-DOMINIO.md, seção 8 (revisada
-- nesta migration); docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md, seção
-- 7 (revisada); ADR-025 (referencia Identity diretamente, nunca
-- IdentityProfile); ADR-028 (accessProfile, bootstrap administrativo).
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
-- Depende de `applications` (0005) e `identities` (0002) já existirem —
-- ordem de aplicação garantida pelo prefixo numérico do arquivo.
--
-- Observação de segurança: um índice único condicional (ex.: "no máximo
-- um GRANTED por identidade+aplicação+perfil") não é nativo no MariaDB
-- sem coluna gerada — não improvisado aqui (task v0.5.0, seção 15). A
-- prevenção de duplicidade ativa é responsabilidade da camada de
-- aplicação (`BootstrapFirstApplicationAccessService`), protegida por
-- named lock + checagem dentro da mesma transação, mesmo princípio já
-- aplicado ao guard one-shot de Identity (ADR-027).
--
-- Políticas ON DELETE / ON UPDATE (explícitas, não implícitas): RESTRICT
-- em todas as FKs desta tabela. Justificativa:
--   - `identities` nunca sofre DELETE físico no fluxo operacional comum
--     (soft delete apenas, ADR-020) — RESTRICT é uma segunda barreira
--     (defesa em profundidade) contra uma exclusão física manual/errada
--     que deixaria `application_accesses` órfã.
--   - `applications` (catálogo estável) não deve ser removida enquanto
--     tiver acessos associados — encadear a remoção automaticamente
--     apagaria silenciosamente o histórico de concessão/auditoria, o
--     que nunca é desejável aqui.
--   - `public_id` é documentado como imutável (ADR-021) em todas as
--     tabelas referenciadas — ON UPDATE RESTRICT reforça essa invariante
--     no nível do banco: uma tentativa de alterar um `public_id` que
--     tenha `application_accesses` dependentes é bloqueada, não permitida
--     silenciosamente.
--   - Encadear a remoção automaticamente para as tabelas filhas, ou
--     limpar a referência para um valor vazio automaticamente, foram
--     ambas deliberadamente descartadas: nenhuma das duas é segura para
--     uma tabela de concessão de acesso / auditoria (perderia rastro de
--     quem foi referenciado).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA (v0.5.0).

CREATE TABLE IF NOT EXISTS application_accesses (
    id                                BIGINT UNSIGNED AUTO_INCREMENT
        COMMENT 'Chave interna, nao exposta.',
    public_id                         CHAR(36)      NOT NULL
        COMMENT 'UUID textual, imutavel, identificador externo (ADR-021).',
    identity_public_id                CHAR(36)      NOT NULL
        COMMENT 'FK para identities.public_id - acesso referencia Identity diretamente, nunca IdentityProfile (ADR-025).',
    application_public_id             CHAR(36)      NOT NULL
        COMMENT 'FK para applications.public_id.',
    access_profile                    ENUM('ADMIN')  NOT NULL
        COMMENT 'Nivel de acesso GLOBAL a aplicacao - nunca permissao fina de negocio do produto consumidor (ADR-007, ADR-028). Novos valores exigem ALTER TABLE futuro, deliberado.',
    status                            ENUM('GRANTED','REVOKED') NOT NULL DEFAULT 'GRANTED',
    granted_at                        DATETIME(3)   NOT NULL,
    granted_by_identity_public_id     CHAR(36)      NULL
        COMMENT 'NULL quando a concessao nao tem Actor autenticado real (ex.: bootstrap administrativo, ADR-028) - nunca um marcador fingindo ser um public_id de Identity.',
    revoked_at                        DATETIME(3)   NULL,
    revoked_by_identity_public_id     CHAR(36)      NULL,
    version                           BIGINT UNSIGNED NOT NULL DEFAULT 1
        COMMENT 'Controle de concorrencia otimista (ADR-024) - sem comando de mutacao (revoke) nesta fatia; reservado para uso futuro.',
    created_at                        DATETIME(3)   NOT NULL,
    updated_at                        DATETIME(3)   NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_application_accesses_public_id (public_id),
    KEY idx_app_access_identity_app_profile_status (identity_public_id, application_public_id, access_profile, status),
    KEY idx_app_access_app_profile_status (application_public_id, access_profile, status),
    KEY idx_app_access_granted_by (granted_by_identity_public_id),
    KEY idx_app_access_revoked_by (revoked_by_identity_public_id),
    CONSTRAINT fk_app_access_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_app_access_application
        FOREIGN KEY (application_public_id) REFERENCES applications (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_app_access_granted_by
        FOREIGN KEY (granted_by_identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_app_access_revoked_by
        FOREIGN KEY (revoked_by_identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Concessao de acesso global a aplicacoes - bounded context access (v0.5.0)';
