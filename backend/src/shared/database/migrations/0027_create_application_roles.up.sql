-- Migration: 0027_create_application_roles
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- CATÁLOGO DE PERFIS POR APLICAÇÃO — a menor extensão genérica que
-- permite ao Ingressa ser a fonte oficial da autorização de um produto
-- consumidor sem virar o dono das regras de negócio dele (ADR-007).
--
-- O que muda e o que NÃO muda:
--
--   `application_accesses.access_profile` (ADMIN/USER, ADR-028/ADR-032)
--   continua sendo a camada 1: "esta pessoa pode ENTRAR no produto?".
--   Ele NÃO ganha valores novos, e nenhum produto consumidor passa a
--   caber no enum global — foi justamente para não empurrar
--   `MEURH_RH_RESPONSAVEL` para dentro de um enum de plataforma que
--   esta tabela existe.
--
--   Esta tabela é o catálogo da camada 2: os PERFIS que uma aplicação
--   declara para si. `PCTEC_MEU_RH` declara os dela em 0029; nenhuma
--   outra aplicação é afetada, e uma aplicação sem linhas aqui
--   simplesmente não tem perfis — exatamente o comportamento de hoje.
--
-- POR QUE O CATÁLOGO FICA EM TABELA E O ENFORCEMENT NÃO. A concessão
-- ("quem tem qual perfil") precisa ser administrável e auditável, e é
-- isso que vive aqui e em 0028. O SIGNIFICADO de um perfil (quais
-- permissões ele carrega, quais rotas ele libera) continua em código no
-- produto consumidor, revisado em pull request — em tabela, viraria
-- controle de acesso editável em produção sem revisão. `permissions`
-- abaixo é a cópia DECLARATIVA desse significado, existente para que a
-- UI administrativa possa exibir "o que este perfil inclui" sem
-- consultar o produto; ela descreve, nunca decide.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).

CREATE TABLE IF NOT EXISTS application_roles (
    id                     BIGINT UNSIGNED AUTO_INCREMENT COMMENT 'Chave interna. NUNCA exposta em API, evento ou log (ADR-021).',
    public_id              CHAR(36)     NOT NULL COMMENT 'UUID textual, imutável, identificador externo (ADR-021).',
    application_public_id  CHAR(36)     NOT NULL COMMENT 'FK para applications.public_id. O perfil pertence a UMA aplicação e não existe fora dela.',
    code                   VARCHAR(64)  NOT NULL COMMENT 'Identificador técnico curto e estável do perfil, ex.: MEURH_RH_RESPONSAVEL. Único DENTRO da aplicação.',
    name                   VARCHAR(160) NOT NULL COMMENT 'Nome de exibição na administração.',
    description            VARCHAR(500) NOT NULL COMMENT 'O que este perfil é, em uma frase, para quem concede.',
    permissions            LONGTEXT     NOT NULL COMMENT 'Lista JSON das permissões que o perfil inclui. DESCRITIVA: serve à exibição na UI; o enforcement é do produto consumidor, em código.'
                           CHECK (JSON_VALID(permissions)),
    sort_order             INT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'Ordem de exibição. Do mais amplo para o mais restrito, para que a lista se leia como uma escala.',
    status                 ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' COMMENT 'INACTIVE deixa de ser concedível; concessões existentes continuam valendo até serem revogadas uma a uma.',
    version                BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Concorrência otimista (ADR-024).',
    created_at             DATETIME(3)  NOT NULL,
    updated_at             DATETIME(3)  NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_application_roles_public_id (public_id),
    UNIQUE KEY uk_application_roles_app_code (application_public_id, code)
        COMMENT 'O código do perfil é único DENTRO da aplicação, nunca globalmente: dois produtos podem ter um perfil "ADMIN" sem colidir.',
    KEY idx_application_roles_app_status (application_public_id, status),
    CONSTRAINT fk_application_roles_application
        FOREIGN KEY (application_public_id) REFERENCES applications (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Catalogo de perfis declarados por aplicacao - camada 2 de ADR-007, generico';
