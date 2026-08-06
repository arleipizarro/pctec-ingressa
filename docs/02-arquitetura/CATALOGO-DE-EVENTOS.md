# Catálogo de Eventos — PCTEC Ingressa

Versão associada: v0.2.0 — Domain Foundation
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
- **Finalidade:** notificar a criação de uma nova identidade no Cadastro
  Mestre.
- **Identificador da entidade:** `identity_id` (UUID).
- **Versão:** 1.
- **Payload mínimo:** `identity_id`, `email`, `status`, `created_at`.
- **Nunca publicar:** `document_number` (dado sensível; consumidores que
  precisarem devem consultar a API sob autorização), qualquer credencial.

### identity.updated

- **Produtor:** `identity`.
- **Finalidade:** notificar alteração de dados cadastrais de uma
  identidade (nome, e-mail, perfis associados).
- **Identificador da entidade:** `identity_id`.
- **Versão:** 1.
- **Payload mínimo:** `identity_id`, campos alterados (nomes dos campos,
  não necessariamente os valores anteriores).
- **Nunca publicar:** `document_number`, credenciais.

### identity.activated

- **Produtor:** `identity`.
- **Finalidade:** notificar que uma identidade saiu de `PENDING` para
  `ACTIVE` (ativação concluída via Magic Link).
- **Identificador da entidade:** `identity_id`.
- **Versão:** 1.
- **Payload mínimo:** `identity_id`, `activated_at`.
- **Nunca publicar:** dados do Magic Link utilizado.

### identity.blocked

- **Produtor:** `identity`.
- **Finalidade:** notificar bloqueio administrativo ou de segurança de uma
  identidade.
- **Identificador da entidade:** `identity_id`.
- **Versão:** 1.
- **Payload mínimo:** `identity_id`, `blocked_at`, `reason_code` (código
  categórico, não texto livre com dados sensíveis).
- **Nunca publicar:** detalhes textuais livres que possam conter dados
  pessoais de terceiros.

### identity.login-enabled

- **Produtor:** `identity`.
- **Finalidade:** notificar mudança do atributo `login_enabled` de uma
  identidade.
- **Identificador da entidade:** `identity_id`.
- **Versão:** 1.
- **Payload mínimo:** `identity_id`, `login_enabled` (novo valor),
  `changed_at`.
- **Nunca publicar:** credenciais.

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
- Necessidade de eventos adicionais para `IdentityProfile` e
  `RefreshToken` isoladamente (hoje cobertos indiretamente por
  `identity.updated` e `session.*`).
