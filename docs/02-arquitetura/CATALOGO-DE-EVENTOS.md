# Catálogo de Eventos — PCTEC Ingressa

Versão associada: v0.2.0 — Domain Foundation (seção `identity.*`
atualizada e expandida pela v0.3.0 — Identity Core, ver
`IDENTITY-DOMAIN-DESIGN.md`, seção 9; eventos `identity.profile-*`
removidos por ADR-025)
Status: Proposto para revisão do Product Owner e do Platform Architect

Este catálogo descreve eventos de domínio de forma conceitual, independente
do mecanismo de transporte (que não está definido nesta fase — ver
`SOFTWARE-ARCHITECTURE-BLUEPRINT.md`, seção 9). Todo evento é versionado e
segue as convenções descritas abaixo.

## Convenções

- Nome do evento: `contexto.acao`, em `kebab-case`/pontuado, minúsculas.
- Todo evento inclui, além do payload mínimo listado: `event_id` (UUID),
  `event_version`, `occurred_at`.
- Todo evento referencia entidades por UUID público — nunca por ID interno.
- Nenhum evento carrega dado sensível (senha, hash de token em forma
  reversível, token em texto puro).

---

### identity.created

- **Produtor:** bounded context `identity`.
- **Finalidade:** notificar a criação de uma nova identidade no diretório
  mestre.
- **Identificador da entidade:** `public_id` (UUID textual).
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `type`, `email`, `status`, `created_at`,
  `correlation_id`, `causation_id`, `actor_public_id`, `occurred_at`.
- **Nunca publicar:** `cpf`/`cpf_normalized`, qualquer credencial, `id`
  interno.

### identity.name-updated

- **Produtor:** `identity`.
- **Finalidade:** notificar alteração do nome de exibição de uma
  identidade.
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `full_name` (novo valor),
  `correlation_id`, `causation_id`, `actor_public_id`, `occurred_at`.
- **Nunca publicar:** `id` interno.

### identity.email-change-requested

- **Produtor:** `identity`.
- **Finalidade:** notificar que uma solicitação de troca de e-mail foi
  registrada, sem que o e-mail efetivo tenha mudado ainda.
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `requested_email`, `correlation_id`,
  `causation_id`, `actor_public_id`, `occurred_at`.
- **Nunca publicar:** dados do mecanismo de confirmação (pertence a
  `security`).

### identity.email-changed

- **Produtor:** `identity`.
- **Finalidade:** notificar que a troca de e-mail foi efetivamente
  confirmada e aplicada.
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `email` (novo valor), `correlation_id`,
  `causation_id`, `actor_public_id`, `occurred_at`.
- **Nunca publicar:** `id` interno.

### identity.login-enabled

- **Produtor:** `identity`.
- **Finalidade:** notificar que o atributo `login_enabled` de uma
  identidade passou a `true`.
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `correlation_id`, `causation_id`,
  `actor_public_id`, `occurred_at`.
- **Nunca publicar:** credenciais.

### identity.login-disabled

- **Produtor:** `identity`.
- **Finalidade:** notificar que o atributo `login_enabled` de uma
  identidade passou a `false`.
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `correlation_id`, `causation_id`,
  `actor_public_id`, `occurred_at`.
- **Nunca publicar:** credenciais.

### identity.activated

- **Produtor:** `identity`.
- **Finalidade:** notificar que uma identidade saiu de `PENDING` para
  `ACTIVE` (ativação concluída via Magic Link).
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `correlation_id`, `causation_id`,
  `actor_public_id`, `occurred_at`.
- **Nunca publicar:** dados do Magic Link utilizado.

### identity.blocked

- **Produtor:** `identity`.
- **Finalidade:** notificar bloqueio administrativo ou de segurança de uma
  identidade (transição `ACTIVE → BLOCKED`).
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `reason_code` (código categórico, não
  texto livre com dados sensíveis), `correlation_id`, `causation_id`,
  `actor_public_id`, `occurred_at`.
- **Nunca publicar:** detalhes textuais livres que possam conter dados
  pessoais de terceiros.

### identity.unblocked

- **Produtor:** `identity`.
- **Finalidade:** notificar a reversão de um bloqueio (transição
  `BLOCKED → ACTIVE`).
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `correlation_id`, `causation_id`,
  `actor_public_id`, `occurred_at`.
- **Nunca publicar:** dados do bloqueio original além do necessário.

### identity.inactivated

- **Produtor:** `identity`.
- **Finalidade:** notificar o encerramento da relevância operacional de
  uma identidade (transição para `INACTIVE`), sem exclusão.
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `correlation_id`, `causation_id`,
  `actor_public_id`, `occurred_at`.
- **Nunca publicar:** `id` interno.

### identity.reactivated

- **Produtor:** `identity`.
- **Finalidade:** notificar a reversão de uma inativação (transição
  `INACTIVE → ACTIVE`).
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `correlation_id`, `causation_id`,
  `actor_public_id`, `occurred_at`.
- **Nunca publicar:** `id` interno.

### identity.deleted

- **Produtor:** `identity`.
- **Finalidade:** notificar a exclusão lógica de uma identidade (transição
  para `DELETED`, estado terminal).
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `deletion_reason` (código categórico),
  `correlation_id`, `causation_id`, `actor_public_id`, `occurred_at`.
- **Nunca publicar:** texto livre associado ao motivo, `id` interno.

### identity.anonymized

- **Produtor:** `identity`.
- **Finalidade:** notificar que os dados pessoais identificáveis de uma
  identidade foram substituídos por valores não reversíveis (procedimento
  controlado, distinto de exclusão lógica — ver ADR-020).
- **Identificador da entidade:** `public_id`.
- **Versão:** 1.
- **Payload mínimo:** `public_id`, `correlation_id`, `causation_id`,
  `actor_public_id`, `occurred_at`.
- **Nunca publicar:** qualquer dado pessoal anterior (nome, e-mail, CPF).

**Nota de correção (v0.3.0 — ADR-025):** os eventos `identity.profile-added`
e `identity.profile-removed`, presentes em versão anterior deste catálogo,
foram removidos — não pertencem ao domínio `identity`. A classificação
relacional (`EMPLOYEE`, `CUSTOMER`, `PARTNER`, `SUPPLIER`) pertence ao
`Membership` (bounded context `organization`/`access`); eventos
equivalentes (`membership.profile-added`/`membership.profile-removed`, ou
cobertos por `membership.updated`), se necessários, serão definidos naquele
contexto.

### organization.created

- **Produtor:** bounded context `organization`.
- **Finalidade:** notificar a criação de uma organização no Cadastro
  Mestre.
- **Identificador da entidade:** `organization_id`.
- **Versão:** 1.
- **Payload mínimo:** `organization_id`, `type`, `legal_name`,
  `created_at`.
- **Nunca publicar:** `document_number` completo sem necessidade
  justificada (Pendente de decisão sobre mascaramento).

### organization.updated

- **Produtor:** `organization`.
- **Finalidade:** notificar alteração de dados cadastrais de uma
  organização, incluindo mudanças em `OrganizationRelationship`.
- **Identificador da entidade:** `organization_id`.
- **Versão:** 1.
- **Payload mínimo:** `organization_id`, campos alterados.
- **Nunca publicar:** dados financeiros ou contratuais (não pertencem ao
  domínio do Ingressa).

### membership.created

- **Produtor:** bounded context `organization`.
- **Finalidade:** notificar a criação de um vínculo entre identidade e
  organização.
- **Identificador da entidade:** `membership_id`.
- **Versão:** 1.
- **Payload mínimo:** `membership_id`, `identity_id`, `organization_id`,
  `scope`, `created_at`.
- **Nunca publicar:** dados de outras organizações não referenciadas no
  vínculo.

### membership.updated

- **Produtor:** `organization`.
- **Finalidade:** notificar alteração ou encerramento de um vínculo
  organizacional.
- **Identificador da entidade:** `membership_id`.
- **Versão:** 1.
- **Payload mínimo:** `membership_id`, `status`, `ended_at` (quando
  aplicável).
- **Nunca publicar:** histórico completo de vínculos anteriores no mesmo
  evento (cada mudança é um evento próprio).

### application.created

- **Produtor:** bounded context `application`.
- **Finalidade:** notificar o registro de uma nova aplicação no catálogo do
  ecossistema.
- **Identificador da entidade:** `application_id`.
- **Versão:** 1.
- **Payload mínimo:** `application_id`, `code`, `name`, `created_at`.
- **Nunca publicar:** segredos ou credenciais técnicas de integração da
  aplicação.

### application-access.granted

- **Produtor:** bounded context `access`.
- **Finalidade:** notificar a concessão de acesso global de uma identidade
  a uma aplicação.
- **Identificador da entidade:** `application_access_id`.
- **Versão:** 1.
- **Payload mínimo:** `application_access_id`, `identity_id`,
  `application_id`, `granted_at`, `granted_by`.
- **Nunca publicar:** qualquer detalhe de permissão interna do produto
  consumidor (o Ingressa não conhece essas regras).

### application-access.revoked

- **Produtor:** `access`.
- **Finalidade:** notificar a revogação de acesso global de uma identidade
  a uma aplicação.
- **Identificador da entidade:** `application_access_id`.
- **Versão:** 1.
- **Payload mínimo:** `application_access_id`, `identity_id`,
  `application_id`, `revoked_at`.
- **Nunca publicar:** motivo em texto livre que contenha dados sensíveis.

### credential.changed

- **Produtor:** bounded context `security`.
- **Finalidade:** notificar que a credencial de uma identidade foi criada
  ou alterada, para fins de auditoria e, futuramente, notificação de
  segurança ao usuário.
- **Identificador da entidade:** `credential_id`.
- **Versão:** 1.
- **Payload mínimo:** `credential_id`, `identity_id`, `type`,
  `changed_at`.
- **Nunca publicar:** `password_hash`, senha em qualquer forma, ou o token
  utilizado para autorizar a mudança.

### session.created

- **Produtor:** `security`.
- **Finalidade:** notificar a criação de uma nova sessão autenticada.
- **Identificador da entidade:** `session_id`.
- **Versão:** 1.
- **Payload mínimo:** `session_id`, `identity_id`, `created_at`,
  `expires_at`.
- **Nunca publicar:** `refresh_token`, `ip_address`/`user_agent` completos
  (Pendente de decisão sobre necessidade e forma de mascaramento).

### session.revoked

- **Produtor:** `security`.
- **Finalidade:** notificar a revogação de uma sessão, seja por ação do
  usuário, administrativa, ou por expiração forçada de segurança.
- **Identificador da entidade:** `session_id`.
- **Versão:** 1.
- **Payload mínimo:** `session_id`, `identity_id`, `revoked_at`,
  `reason_code`.
- **Nunca publicar:** dados de outras sessões ativas da mesma identidade.

### magic-link.created

- **Produtor:** `security`.
- **Finalidade:** notificar a criação de um Magic Link, para orquestração
  do envio pelo canal apropriado (fora do domínio central).
- **Identificador da entidade:** `magic_link_id`.
- **Versão:** 1.
- **Payload mínimo:** `magic_link_id`, `identity_id`, `type`,
  `expires_at`.
- **Nunca publicar:** o token em texto puro ou seu hash.

### magic-link.consumed

- **Produtor:** `security`.
- **Finalidade:** notificar o consumo bem-sucedido de um Magic Link.
- **Identificador da entidade:** `magic_link_id`.
- **Versão:** 1.
- **Payload mínimo:** `magic_link_id`, `identity_id`, `type`,
  `consumed_at`.
- **Nunca publicar:** o token em texto puro ou seu hash.

---

## Questões pendentes de decisão

- Mecanismo de transporte (barramento, fila ou API de polling) — nenhuma
  tecnologia aprovada nesta fase.
- Política de mascaramento de `ip_address`/`user_agent` em eventos
  relacionados a `Session`.
- Necessidade de eventos adicionais para `RefreshToken` isoladamente (hoje
  cobertos indiretamente por `session.*`).
- Eventos para a classificação relacional (`EMPLOYEE`/`CUSTOMER`/`PARTNER`/
  `SUPPLIER`) — antes propostos como `identity.profile-added`/
  `identity.profile-removed`, removidos por ADR-025 (v0.3.0). Se
  necessários, serão definidos no bounded context `organization`/`access`,
  associados a `Membership`/`MembershipProfile`, não a `Identity`.
- **Nomenclatura de referência a Identity em eventos de outros bounded
  contexts (v0.3.0 — ADR-021):** os eventos `identity.*` passaram a usar
  `public_id` como identificador (ver seção acima), enquanto eventos de
  outros contextos que referenciam uma identidade
  (`membership.created`, `application-access.granted`/`revoked`,
  `credential.changed`, `session.created`/`revoked`,
  `magic-link.created`/`consumed`) ainda usam o campo `identity_id`,
  herdado da nomenclatura da v0.2.0. Ambos os campos referem-se ao mesmo
  valor (o identificador público da `Identity`), mas o nome do campo está
  inconsistente entre contextos. Renomear esses campos para
  `identity_public_id` está fora do escopo desta entrega (restrita ao
  bounded context `identity`) e fica registrado aqui como pendência para
  uma revisão de consistência de plataforma futura.
