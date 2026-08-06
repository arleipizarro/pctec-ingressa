# Modelo Relacional Proposto — PCTEC Ingressa (MariaDB)

Versão associada: v0.2.0 — Domain Foundation
Status: Proposta conceitual, **não é migration executável**

Este documento apresenta tabelas conceituais para o banco `pctec_ingressa`
em MariaDB, derivadas do `MODELO-DE-DOMINIO.md`. Nenhum SQL aqui deve ser
executado como migration nesta fase — trata-se de material para revisão
arquitetural do Product Owner e do Platform Architect.

## Convenções gerais

- Motor: MariaDB 10.11 (Ubuntu 24.04), engine InnoDB. Confirmado pelo
  Product Owner — ver ADR-016.
- Nomes de tabela e coluna em inglês, `snake_case`.
- Toda tabela possui `id BINARY(16)` como UUID público (armazenado em
  formato binário para eficiência de índice; representação textual via
  camada de aplicação) e, quando necessário por performance, um
  `internal_id BIGINT UNSIGNED AUTO_INCREMENT` como chave primária interna
  não exposta.
- Toda tabela possui `created_at DATETIME` e `updated_at DATETIME`.
- Soft delete é aplicado apenas onde o domínio prevê estado
  inativo/revogado reversível; exclusão física não é o padrão para
  entidades de identidade e acesso, dado o requisito de auditoria.
- Charset: `utf8mb4`. Collation oficial: `utf8mb4_unicode_520_ci`,
  confirmada por verificação de capacidade no servidor DEV (MariaDB
  10.11.14) — ver ADR-016. `utf8mb4_uca1400_ai_ci` não está disponível
  nesta versão de servidor; `utf8mb4_general_ci` permanece documentada
  apenas como fallback de compatibilidade, não como padrão.

## 1. identities

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna, não exposta |
| id | BINARY(16) | UUID público, `UNIQUE NOT NULL` |
| full_name | VARCHAR(255) | NOT NULL |
| email | VARCHAR(255) | NOT NULL, único case-insensitive |
| email_normalized | VARCHAR(255) | Gerada/mantida em lowercase para garantir unicidade case-insensitive |
| document_number | VARCHAR(14) | Opcional, normalizado (somente dígitos) |
| status | ENUM('PENDING','ACTIVE','BLOCKED','INACTIVE') | NOT NULL |
| login_enabled | TINYINT(1) | NOT NULL, default 0 |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_identities_public_id (id)`.
- `UNIQUE KEY uk_identities_email_normalized (email_normalized)`.
- `UNIQUE KEY uk_identities_document_number (document_number)` — índice
  único que permite múltiplos `NULL` (comportamento padrão do MariaDB para
  `UNIQUE` com `NULL`), preservando a opcionalidade do CPF.
- `KEY idx_identities_status (status)`.

Observações de segurança: nenhuma coluna desta tabela armazena credencial;
`email` é dado pessoal e deve ser tratado conforme política de dados
pessoais (fora do escopo desta entrega).

## 2. identity_profiles

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| identity_internal_id | BIGINT UNSIGNED | FK → identities.internal_id |
| profile | ENUM('EMPLOYEE','CUSTOMER','PARTNER','SUPPLIER','SERVICE_ACCOUNT') | NOT NULL |
| status | ENUM('ACTIVE','INACTIVE') | NOT NULL |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_identity_profiles_public_id (id)`.
- `UNIQUE KEY uk_identity_profile_unique (identity_internal_id, profile)` —
  impede duplicidade do mesmo perfil para a mesma identidade.
- `FOREIGN KEY fk_identity_profiles_identity (identity_internal_id)
  REFERENCES identities(internal_id)`.

Observações: `SERVICE_ACCOUNT` incluído no enum apenas como valor futuro;
uso efetivo é Pendente de decisão (ver Modelo de Domínio).

## 3. organizations

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| type | ENUM('BUSINESS_GROUP','COMPANY') | NOT NULL |
| legal_name | VARCHAR(255) | NOT NULL |
| trade_name | VARCHAR(255) | NULL |
| document_number | VARCHAR(20) | NULL, normalizado |
| status | ENUM('ACTIVE','INACTIVE') | NOT NULL |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_organizations_public_id (id)`.
- `UNIQUE KEY uk_organizations_document_type (document_number, type)` —
  unicidade condicionada ao tipo, permitindo múltiplos `NULL`.
- `KEY idx_organizations_type_status (type, status)`.

## 4. organization_relationships

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| parent_organization_internal_id | BIGINT UNSIGNED | FK → organizations.internal_id (tipo BUSINESS_GROUP) |
| child_organization_internal_id | BIGINT UNSIGNED | FK → organizations.internal_id (tipo COMPANY) |
| created_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_org_rel_public_id (id)`.
- `UNIQUE KEY uk_org_rel_child (child_organization_internal_id)` — no MVP,
  uma empresa pertence a no máximo um grupo.
- `FOREIGN KEY fk_org_rel_parent (parent_organization_internal_id)
  REFERENCES organizations(internal_id)`.
- `FOREIGN KEY fk_org_rel_child (child_organization_internal_id)
  REFERENCES organizations(internal_id)`.

Observações: a validação de que `parent` é `BUSINESS_GROUP` e `child` é
`COMPANY` é responsabilidade da camada de aplicação/domínio; MariaDB não
expressa essa restrição de forma nativa sem trigger (trigger não está
aprovado nesta fase).

## 5. memberships

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| identity_internal_id | BIGINT UNSIGNED | FK → identities.internal_id |
| identity_profile_internal_id | BIGINT UNSIGNED | FK → identity_profiles.internal_id (Pendente de decisão — ver Modelo de Domínio) |
| organization_internal_id | BIGINT UNSIGNED | FK → organizations.internal_id |
| scope | ENUM('ORGANIZATION_ONLY','ORGANIZATION_AND_DESCENDANTS') | NOT NULL |
| status | ENUM('ACTIVE','INACTIVE') | NOT NULL |
| started_at | DATETIME | NOT NULL |
| ended_at | DATETIME | NULL |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_memberships_public_id (id)`.
- `UNIQUE KEY uk_membership_unique (identity_profile_internal_id,
  organization_internal_id)` — impede vínculo duplicado ativo.
- `KEY idx_memberships_identity (identity_internal_id)`.
- `KEY idx_memberships_organization (organization_internal_id)`.
- `FOREIGN KEY` para `identities`, `identity_profiles` e `organizations`.

## 6. applications

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| code | VARCHAR(64) | NOT NULL, único (ex.: `PCTEC-PORTAL`) |
| name | VARCHAR(255) | NOT NULL |
| status | ENUM('ACTIVE','INACTIVE') | NOT NULL |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_applications_public_id (id)`.
- `UNIQUE KEY uk_applications_code (code)`.

## 7. application_access

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| identity_internal_id | BIGINT UNSIGNED | FK → identities.internal_id |
| identity_profile_internal_id | BIGINT UNSIGNED | FK → identity_profiles.internal_id, NULL permitido (Pendente de decisão) |
| application_internal_id | BIGINT UNSIGNED | FK → applications.internal_id |
| status | ENUM('GRANTED','REVOKED') | NOT NULL |
| granted_at | DATETIME | NOT NULL |
| revoked_at | DATETIME | NULL |
| granted_by_internal_id | BIGINT UNSIGNED | FK → identities.internal_id, NULL permitido (ação do sistema) |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_app_access_public_id (id)`.
- `KEY idx_app_access_identity_app (identity_internal_id,
  application_internal_id, status)`.
- `FOREIGN KEY` para `identities`, `identity_profiles` e `applications`.

Observações de segurança: `status = GRANTED` duplicado para a mesma
combinação identidade/aplicação deve ser prevenido na camada de aplicação
(índice único condicional não é nativo no MariaDB sem coluna gerada; solução
definitiva Pendente de decisão).

## 8. credentials

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| identity_internal_id | BIGINT UNSIGNED | FK → identities.internal_id |
| type | ENUM('LOCAL_PASSWORD') | NOT NULL |
| password_hash | VARCHAR(255) | NOT NULL; algoritmo Pendente de decisão |
| status | ENUM('ACTIVE','REVOKED') | NOT NULL |
| last_changed_at | DATETIME | NOT NULL |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_credentials_public_id (id)`.
- `KEY idx_credentials_identity_type_status (identity_internal_id, type,
  status)`.

Observações de segurança: `password_hash` nunca armazena texto puro;
tamanho da coluna dimensionado para acomodar algoritmos modernos de hash
(ex.: Argon2id), mas o algoritmo em si permanece Pendente de decisão.

## 9. magic_links

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| identity_internal_id | BIGINT UNSIGNED | FK → identities.internal_id |
| type | ENUM('ACTIVATION','PASSWORD_RESET','EMAIL_CONFIRMATION','EMAIL_CHANGE','MFA_ENROLL','DEVICE_APPROVAL') | NOT NULL |
| token_hash | VARCHAR(255) | NOT NULL; nunca texto puro |
| status | ENUM('PENDING','CONSUMED','EXPIRED','REVOKED') | NOT NULL |
| expires_at | DATETIME | NOT NULL |
| consumed_at | DATETIME | NULL |
| created_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_magic_links_public_id (id)`.
- `UNIQUE KEY uk_magic_links_token_hash (token_hash)`.
- `KEY idx_magic_links_identity_type_status (identity_internal_id, type,
  status)`.
- `KEY idx_magic_links_expires_at (expires_at)` — apoia rotina de
  expiração/limpeza.

Observações de segurança: coluna de token em texto puro não existe nesta
tabela, por definição de arquitetura (ADR-012).

## 10. sessions

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| identity_internal_id | BIGINT UNSIGNED | FK → identities.internal_id |
| status | ENUM('ACTIVE','REVOKED','EXPIRED') | NOT NULL |
| ip_address | VARBINARY(16) | NULL; suporta IPv4 e IPv6; retenção Pendente de decisão |
| user_agent | VARCHAR(512) | NULL |
| expires_at | DATETIME | NOT NULL |
| revoked_at | DATETIME | NULL |
| created_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_sessions_public_id (id)`.
- `KEY idx_sessions_identity_status (identity_internal_id, status)`.
- `KEY idx_sessions_expires_at (expires_at)`.

## 11. refresh_tokens

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| session_internal_id | BIGINT UNSIGNED | FK → sessions.internal_id |
| token_hash | VARCHAR(255) | NOT NULL; nunca texto puro |
| status | ENUM('ACTIVE','ROTATED','REVOKED','EXPIRED') | NOT NULL |
| expires_at | DATETIME | NOT NULL |
| created_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_refresh_tokens_public_id (id)`.
- `UNIQUE KEY uk_refresh_tokens_token_hash (token_hash)`.
- `FOREIGN KEY fk_refresh_tokens_session (session_internal_id) REFERENCES
  sessions(internal_id)`.

## 12. audit_events

| Coluna | Tipo MariaDB | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna |
| id | BINARY(16) | UUID público, único |
| event_type | VARCHAR(100) | NOT NULL (ex.: `identity.created`) |
| event_version | SMALLINT UNSIGNED | NOT NULL |
| entity_type | VARCHAR(64) | NOT NULL |
| entity_id | BINARY(16) | NOT NULL — referência ao UUID público da entidade afetada |
| actor_identity_internal_id | BIGINT UNSIGNED | NULL; FK → identities.internal_id |
| payload_json | JSON | Dados mínimos do evento; nunca dados sensíveis |
| occurred_at | DATETIME | NOT NULL |

Chaves e índices:

- PK: `internal_id`.
- `UNIQUE KEY uk_audit_events_public_id (id)`.
- `KEY idx_audit_events_entity (entity_type, entity_id)`.
- `KEY idx_audit_events_type_occurred (event_type, occurred_at)`.

Observações de segurança: `audit_events` não possui soft delete nem
mecanismo de update — é uma tabela append-only por definição de domínio;
qualquer necessidade de expurgo segue política de retenção separada,
Pendente de decisão.

## Observações gerais de segurança

- Nenhuma tabela armazena token ou senha em texto puro; todas as colunas
  sensíveis são `*_hash`.
- Todas as FKs entre tabelas deste banco são internas ao domínio do
  Ingressa; nenhuma FK cruza para bancos de outros produtos (proibido pela
  Constituição da Plataforma, seção 4).
- Soft delete (`status = INACTIVE/REVOKED`, sem exclusão física) é o padrão
  para `identities`, `organizations`, `identity_profiles`, `memberships`,
  `application_access`, `credentials`, `sessions` e `refresh_tokens`,
  preservando histórico para auditoria. `audit_events` e
  `organization_relationships` não possuem soft delete: o primeiro por ser
  append-only, o segundo por ser um vínculo binário (existe ou não existe).

## Questões pendentes de decisão

- Estratégia de índice único condicional para `application_access.status =
  GRANTED` (coluna gerada, ou validação exclusiva em camada de aplicação).
- Política de retenção de `ip_address`/`user_agent` em `sessions`.
- Particionamento ou arquivamento futuro de `audit_events` em caso de alto
  volume.
