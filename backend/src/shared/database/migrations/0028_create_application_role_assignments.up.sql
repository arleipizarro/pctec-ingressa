-- Migration: 0028_create_application_role_assignments
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- CONCESSÃO de um perfil de aplicação a uma identidade. É esta tabela
-- que faz do Ingressa a fonte oficial da autorização: a partir daqui, o
-- produto consumidor CARREGA o que a pessoa é, e não mantém uma segunda
-- lista própria que precise ser concedida à mão por CLI ou por INSERT
-- no banco dele. Duas listas seriam duas verdades, e a segunda sempre
-- discorda da primeira no dia em que alguém esquece de atualizar uma.
--
-- POR QUE A CONCESSÃO REFERENCIA (identity, application) E NÃO A LINHA
-- DE `application_accesses`. Trocar o `access_profile` de alguém é, no
-- modelo de 0017, revogar + conceder: uma linha nova de acesso. Se os
-- perfis pendurassem na linha do acesso, promover alguém de USER para
-- ADMIN apagaria em silêncio todos os perfis de produto que ela tinha.
-- O vínculo aqui é com a PESSOA na APLICAÇÃO, que é o que de fato não
-- muda quando o nível global muda.
--
-- A CAMADA 1 CONTINUA SENDO PRÉ-REQUISITO. Um perfil concedido aqui não
-- dá acesso a nada por si: sem `ApplicationAccess` GRANTED na mesma
-- aplicação, o produto consumidor não deve reconhecer permissão alguma.
-- Perfil é o que a pessoa FAZ dentro do produto; entrar nele é decisão
-- da camada 1, e uma nunca substitui a outra.
--
-- SEM EXCLUSÃO FÍSICA (ADR-020, mesmo princípio de `application_accesses`):
-- revogar carimba `revoked_at` e mantém a linha. "Quem concedeu, quando,
-- quem revogou e quando" é justamente o que a administração precisa
-- mostrar, e uma linha apagada não responde nada disso.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).

CREATE TABLE IF NOT EXISTS application_role_assignments (
    id                     BIGINT UNSIGNED AUTO_INCREMENT COMMENT 'Chave interna, nunca exposta.',
    public_id              CHAR(36)     NOT NULL COMMENT 'UUID textual, imutável, identificador externo (ADR-021).',
    identity_public_id     CHAR(36)     NOT NULL COMMENT 'FK para identities.public_id - a concessão referencia Identity diretamente (ADR-025).',
    application_public_id  CHAR(36)     NOT NULL COMMENT 'FK para applications.public_id. Redundante com application_roles, e deliberado: é o que permite a unicidade e a busca por (pessoa, aplicação) sem JOIN.',
    role_code              VARCHAR(64)  NOT NULL COMMENT 'Código do perfil em application_roles, dentro da MESMA aplicação.',
    status                 ENUM('GRANTED','REVOKED') NOT NULL DEFAULT 'GRANTED',
    granted_at             DATETIME(3)  NOT NULL,
    granted_by_identity_public_id CHAR(36) NULL COMMENT 'NULL apenas quando não houve actor autenticado real (reconciliação de bootstrap) - nunca um marcador fingindo ser public_id de Identity.',
    granted_by_label       VARCHAR(80)  NULL COMMENT 'Como a concessão foi feita quando não houve actor: RECONCILIACAO, BOOTSTRAP. Texto fechado, escrito pelo código, nunca entrada de usuário.',
    revoked_at             DATETIME(3)  NULL,
    revoked_by_identity_public_id CHAR(36) NULL,
    version                BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Concorrência otimista (ADR-024).',
    created_at             DATETIME(3)  NOT NULL,
    updated_at             DATETIME(3)  NOT NULL,
    active_grant_flag      TINYINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'GRANTED' THEN 1 ELSE NULL END) VIRTUAL
                           COMMENT 'Coluna gerada, uso exclusivo da unique abaixo - nunca lida ou gravada pela aplicacao. Flag numerica pelo mesmo motivo de 0017: o MariaDB 10.11 recusa indexar coluna gerada que passe CHAR por funcao de string (ERROR 1901).',
    PRIMARY KEY (id),
    UNIQUE KEY uk_application_role_assignments_public_id (public_id),
    UNIQUE KEY uk_app_role_assignment_active (identity_public_id, application_public_id, role_code, active_grant_flag)
        COMMENT 'No maximo UMA concessao GRANTED por (pessoa, aplicacao, perfil), garantida NO BANCO e sem janela de corrida. Linhas REVOKED tem flag NULL e nunca colidem, entao o historico de conceder-revogar-conceder cabe na mesma chave.',
    KEY idx_app_role_assignment_lookup (identity_public_id, application_public_id, status),
    KEY idx_app_role_assignment_by_role (application_public_id, role_code, status),
    KEY idx_app_role_assignment_granted_by (granted_by_identity_public_id),
    KEY idx_app_role_assignment_revoked_by (revoked_by_identity_public_id),
    CONSTRAINT fk_app_role_assignment_identity
        FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_app_role_assignment_role
        FOREIGN KEY (application_public_id, role_code) REFERENCES application_roles (application_public_id, code)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_app_role_assignment_granted_by
        FOREIGN KEY (granted_by_identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_app_role_assignment_revoked_by
        FOREIGN KEY (revoked_by_identity_public_id) REFERENCES identities (public_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Concessao de perfis de aplicacao a identidades - camada 2 de ADR-007, fonte oficial';
