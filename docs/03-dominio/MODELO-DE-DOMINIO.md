# Modelo de Domínio — PCTEC Ingressa

Versão associada: v0.2.0 — Domain Foundation
Status: Proposto para revisão do Product Owner e do Platform Architect

Este documento substitui e expande a versão anterior deste arquivo (v0.1.0),
que continha apenas uma listagem resumida de entidades. Nenhuma decisão
anterior foi contrariada; as entidades `Role` e `Permission` citadas na
versão anterior foram reformuladas como `Profile` + `ApplicationAccess`,
conforme ADR-007 (autorização em duas camadas) — não existe autorização
fina de negócio no Ingressa, portanto não há um par genérico Role/Permission
no núcleo do domínio.

Convenção adotada: nomes de entidade, atributo e evento em inglês; texto
explicativo em português.

## Índice de entidades

1. Identity
2. IdentityProfile
3. Organization
4. OrganizationRelationship
5. Membership
6. Profile
7. Application
8. ApplicationAccess
9. Credential
10. MagicLink
11. Session
12. RefreshToken
13. AuditEvent

---

## 1. Identity

**Responsabilidade:** representar univocamente uma pessoa no ecossistema
PCTEC. É a raiz de identidade — tudo que se refere a "quem é o usuário"
converge para uma única `Identity`.

**Atributos conceituais:**

- `id` (UUID público, imutável).
- `internal_id` (identificador numérico interno, nunca exposto em API).
- `full_name`.
- `email` (único globalmente, case-insensitive).
- `document_number` (CPF, opcional, normalizado quando informado).
- `status` (`PENDING`, `ACTIVE`, `BLOCKED`, `INACTIVE`).
- `login_enabled` (booleano, independente de `status`).
- `created_at`, `updated_at`.

**Invariantes:**

- Uma pessoa possui exatamente uma `Identity`.
- `email` é obrigatório no cadastro e único globalmente, comparado de forma
  case-insensitive.
- Existe apenas um `email` por identidade no MVP (sem múltiplos e-mails).
- `document_number` é opcional; quando informado, deve ser normalizado
  (apenas dígitos) e ser único entre as identidades que o informaram.
- `login_enabled = true` não é automático a partir de `status = ACTIVE`; são
  dimensões independentes. Uma identidade pode existir, estar `ACTIVE` e
  ainda assim não estar habilitada para login (por exemplo, um cliente
  cadastrado por um vínculo comercial que ainda não deve acessar sistemas).
- `id` (UUID público) nunca muda após a criação.

**Relacionamentos:**

- Uma `Identity` possui um ou mais `IdentityProfile`.
- Uma `Identity` possui zero ou mais `Membership`.
- Uma `Identity` possui zero ou uma `Credential` ativa por tipo de
  mecanismo de autenticação (no MVP, apenas senha local).
- Uma `Identity` possui zero ou mais `Session`.
- Uma `Identity` pode ser alvo de zero ou mais `MagicLink`.

**Status conceituais:**

- `PENDING`: identidade criada, aguardando ativação.
- `ACTIVE`: identidade ativa e utilizável conforme `login_enabled`.
- `BLOCKED`: identidade bloqueada administrativamente ou por segurança.
- `INACTIVE`: identidade desativada (ex.: desligamento, encerramento de
  relação comercial).

**Eventos de domínio:** `identity.created`, `identity.updated`,
`identity.activated`, `identity.blocked`, `identity.login-enabled`.

**O que não pertence a esta entidade:**

- Papel de negócio dentro de um produto consumidor (isso é responsabilidade
  do produto consumidor).
- Vínculo organizacional (isso é `Membership`).
- Mecanismo de autenticação (isso é `Credential`).

---

## 2. IdentityProfile

**Responsabilidade:** associar uma `Identity` a um ou mais `Profile`,
representando os diferentes contextos em que essa pessoa existe no
ecossistema (por exemplo, a mesma pessoa pode ser `EMPLOYEE` e, em outro
contexto, `CUSTOMER`).

**Atributos conceituais:**

- `id` (UUID público).
- `identity_id` (referência à Identity).
- `profile` (enum `Profile`).
- `status` (`ACTIVE`, `INACTIVE`).
- `created_at`, `updated_at`.

**Invariantes:**

- Uma `Identity` não pode ter dois `IdentityProfile` ativos com o mesmo
  valor de `profile` simultaneamente (não duplica o mesmo perfil).
- Um `IdentityProfile` inativo pode ser reativado sem gerar novo UUID.

**Relacionamentos:**

- Pertence a exatamente uma `Identity`.
- Pode ser referenciado por `Membership` (o vínculo organizacional se dá no
  contexto de um perfil, por exemplo "colaborador" da empresa X).
- Pode ser referenciado por `ApplicationAccess` (o acesso global pode ser
  concedido no contexto de um perfil específico).

**Status conceituais:** `ACTIVE`, `INACTIVE`.

**Eventos de domínio:** cobertos por `identity.updated` nesta fase; não
possui eventos próprios no MVP.

**O que não pertence a esta entidade:**

- Regras de acesso a aplicações (isso é `ApplicationAccess`).
- Vínculo com organização (isso é `Membership`).

---

## 3. Organization

**Responsabilidade:** representar o Cadastro Mestre de grupos empresariais
e empresas do ecossistema PCTEC.

**Atributos conceituais:**

- `id` (UUID público).
- `internal_id` (interno, não exposto).
- `type` (`BUSINESS_GROUP`, `COMPANY`).
- `legal_name`.
- `trade_name` (opcional).
- `document_number` (CNPJ, formato a validar em fase futura).
- `status` (`ACTIVE`, `INACTIVE`).
- `created_at`, `updated_at`.

**Invariantes:**

- `type` define o papel da organização na hierarquia: `BUSINESS_GROUP` pode
  ter `COMPANY` descendentes; `COMPANY` não possui organizações
  descendentes no MVP.
- Filiais, departamentos, locais logísticos e unidades operacionais não são
  modelados como `Organization` nesta fase (fora do MVP).
- `document_number`, quando presente, deve ser único por `type`.

**Relacionamentos:**

- Pode se relacionar com outra `Organization` por meio de
  `OrganizationRelationship` (grupo → empresa).
- Recebe `Membership` de identidades.
- É referenciada por `ApplicationAccess` quando a concessão de acesso é
  contextualizada por organização (Pendente de decisão — ver seção final).

**Status conceituais:** `ACTIVE`, `INACTIVE`.

**Eventos de domínio:** `organization.created`, `organization.updated`.

**O que não pertence a esta entidade:**

- Filiais, departamentos, centros de custo, locais logísticos (fora do
  MVP).
- Regras comerciais, contratuais ou financeiras de cada empresa (isso
  pertence aos produtos consumidores, por exemplo o Portal).

---

## 4. OrganizationRelationship

**Responsabilidade:** representar a relação hierárquica entre duas
organizações — hoje, exclusivamente grupo empresarial contendo empresas.

**Atributos conceituais:**

- `id` (UUID público).
- `parent_organization_id` (referência à `Organization` do tipo
  `BUSINESS_GROUP`).
- `child_organization_id` (referência à `Organization` do tipo `COMPANY`).
- `created_at`.

**Invariantes:**

- `parent_organization_id` deve referenciar uma `Organization` do tipo
  `BUSINESS_GROUP`.
- `child_organization_id` deve referenciar uma `Organization` do tipo
  `COMPANY`.
- Uma `COMPANY` pertence a no máximo um `BUSINESS_GROUP` no MVP (hierarquia
  simples, sem múltiplos grupos para a mesma empresa).
- Não há ciclos (uma organização não pode ser ancestral de si mesma).

**Relacionamentos:**

- Conecta duas instâncias de `Organization`.

**Status conceituais:** não aplicável (relação existe ou não existe;
remoção é modelada como exclusão do vínculo, não como status).

**Eventos de domínio:** cobertos por `organization.updated` nesta fase; não
possui eventos próprios no MVP.

**O que não pertence a esta entidade:**

- Hierarquias multiníveis além de grupo → empresa (fora do MVP).
- Vínculo de identidade com organização (isso é `Membership`).

---

## 5. Membership

**Responsabilidade:** representar o vínculo de uma `Identity` (no contexto
de um `IdentityProfile`) com uma `Organization`.

**Atributos conceituais:**

- `id` (UUID público).
- `identity_id`.
- `identity_profile_id` (Pendente de decisão — ver observação abaixo).
- `organization_id`.
- `scope` (`ORGANIZATION_ONLY`, `ORGANIZATION_AND_DESCENDANTS`).
- `status` (`ACTIVE`, `INACTIVE`).
- `started_at`, `ended_at` (opcional).
- `created_at`, `updated_at`.

**Invariantes:**

- `scope = ORGANIZATION_AND_DESCENDANTS` só é válido quando
  `organization_id` referencia uma `Organization` do tipo `BUSINESS_GROUP`;
  para `COMPANY`, o escopo é sempre equivalente a `ORGANIZATION_ONLY`, pois
  não há descendentes.
- Acesso a um `BUSINESS_GROUP` não herda automaticamente as `COMPANY`
  filhas sem que `scope = ORGANIZATION_AND_DESCENDANTS` esteja
  explicitamente definido.
- Uma `Identity` pode ter múltiplos `Membership` ativos simultaneamente,
  inclusive em organizações diferentes.
- Não deve haver dois `Membership` ativos idênticos (mesma identidade,
  mesma organização, mesmo perfil).

**Relacionamentos:**

- Pertence a uma `Identity` (e, conceitualmente, a um `IdentityProfile`
  específico).
- Referencia uma `Organization`.

**Status conceituais:** `ACTIVE`, `INACTIVE`.

**Eventos de domínio:** `membership.created`, `membership.updated`.

**O que não pertence a esta entidade:**

- Papéis operacionais dentro da organização (cargo, centro de custo) — fora
  do MVP.
- Acesso a aplicações (isso é `ApplicationAccess`).

**Pendente de decisão:** se `Membership` referencia diretamente
`IdentityProfile` (vínculo já contextualizado ao perfil) ou se referencia
`Identity` de forma perfil-agnóstica e o perfil é inferido separadamente.
Esta entrega assume a primeira opção como proposta, a confirmar com o
Platform Architect.

---

## 6. Profile

**Responsabilidade:** enum de domínio que representa os contextos possíveis
em que uma `Identity` pode existir no ecossistema.

**Atributos conceituais (valores do enum):**

- `EMPLOYEE`.
- `CUSTOMER`.
- `PARTNER`.
- `SUPPLIER`.
- `SERVICE_ACCOUNT` (futuro — Pendente de decisão sobre entrada no MVP).

**Invariantes:**

- `Profile` é um tipo de valor (enum), não uma entidade com ciclo de vida
  próprio; quem tem ciclo de vida é `IdentityProfile`.

**Relacionamentos:**

- Referenciado por `IdentityProfile`.

**Status conceituais:** não aplicável (é um enum).

**Eventos de domínio:** não aplicável diretamente; mudanças de perfil são
capturadas via `identity.updated`.

**O que não pertence a esta entidade:**

- Qualquer permissão ou papel de negócio específico de produto consumidor.
- Não deve ser confundido com coluna booleana simplista como `admin=true` —
  acesso administrativo à plataforma, se necessário, deve ser modelado
  explicitamente como concessão de `ApplicationAccess` a uma aplicação
  administrativa própria do Ingressa, não como flag em `Identity`.

---

## 7. Application

**Responsabilidade:** representar o catálogo de produtos do ecossistema
PCTEC que podem ser alvo de concessão de acesso global.

**Atributos conceituais:**

- `id` (UUID público).
- `code` (identificador técnico curto, ex.: `PCTEC-PORTAL`, único).
- `name` (nome de exibição).
- `status` (`ACTIVE`, `INACTIVE`).
- `created_at`, `updated_at`.

**Invariantes:**

- `code` é único e imutável após a criação.
- `Application` não armazena regras de permissão interna do produto — apenas
  metadados de catálogo.

**Relacionamentos:**

- Referenciada por `ApplicationAccess`.

**Status conceituais:** `ACTIVE`, `INACTIVE`.

**Eventos de domínio:** `application.created`.

**O que não pertence a esta entidade:**

- Permissões, papéis ou regras internas do produto.
- Endpoints, credenciais técnicas de integração ou segredos (Pendente de
  decisão sobre onde esse metadado técnico será armazenado; provavelmente
  fora do escopo de domínio do Ingressa).

---

## 8. ApplicationAccess

**Responsabilidade:** representar a concessão (ou revogação) de acesso
global de uma `Identity`/`IdentityProfile` a uma `Application`.

**Atributos conceituais:**

- `id` (UUID público).
- `identity_id`.
- `identity_profile_id` (Pendente de decisão, mesma observação de
  `Membership`).
- `application_id`.
- `status` (`GRANTED`, `REVOKED`).
- `granted_at`, `revoked_at` (opcional).
- `granted_by` (referência à `Identity` que concedeu — auditoria de quem
  concedeu).
- `created_at`, `updated_at`.

**Invariantes:**

- Não deve haver dois registros `ApplicationAccess` com `status = GRANTED`
  para a mesma combinação de identidade (e perfil, se aplicável) e
  aplicação.
- Revogar acesso não apaga o histórico; cria um novo estado (`REVOKED`) ou
  atualiza o registro preservando `granted_at`/`revoked_at` para fins de
  auditoria.
- `ApplicationAccess` nunca contém regras de permissão fina — apenas
  entra/não entra.

**Relacionamentos:**

- Referencia `Identity` (e opcionalmente `IdentityProfile`).
- Referencia `Application`.

**Status conceituais:** `GRANTED`, `REVOKED`.

**Eventos de domínio:** `application-access.granted`,
`application-access.revoked`.

**O que não pertence a esta entidade:**

- Qualquer decisão sobre o que o usuário pode fazer dentro do produto.

---

## 9. Credential

**Responsabilidade:** representar o mecanismo de autenticação de uma
`Identity`. No MVP, exclusivamente credencial local (senha).

**Atributos conceituais:**

- `id` (UUID público).
- `identity_id`.
- `type` (`LOCAL_PASSWORD`; outros tipos são futuros e não fazem parte do
  MVP).
- `password_hash` (nunca texto puro; algoritmo Pendente de decisão).
- `status` (`ACTIVE`, `REVOKED`).
- `last_changed_at`.
- `created_at`, `updated_at`.

**Invariantes:**

- Senha nunca é armazenada, logada ou trafegada em texto puro em nenhuma
  camada do domínio.
- Não existe senha provisória: a primeira credencial só é criada como
  consequência de um `MagicLink` do tipo `ACTIVATION` sendo consumido com
  sucesso.
- Uma `Identity` possui no máximo uma `Credential` ativa do tipo
  `LOCAL_PASSWORD` por vez.

**Relacionamentos:**

- Pertence a exatamente uma `Identity`.

**Status conceituais:** `ACTIVE`, `REVOKED`.

**Eventos de domínio:** `credential.changed`.

**O que não pertence a esta entidade:**

- Algoritmo de hash específico (Pendente de decisão — apenas o requisito de
  "nunca texto puro, sempre hash resistente" está definido nesta fase).
- MFA (previsto no modelo por meio do tipo `MFA_ENROLL` de `MagicLink`, mas
  o mecanismo de segundo fator em si é Pendente de decisão).

---

## 10. MagicLink

**Responsabilidade:** generalizar todo mecanismo de ação sensível iniciada
por link expirável e de uso único, eliminando a necessidade de senha
provisória.

**Atributos conceituais:**

- `id` (UUID público).
- `identity_id`.
- `type` (`ACTIVATION`, `PASSWORD_RESET`, `EMAIL_CONFIRMATION`,
  `EMAIL_CHANGE`, `MFA_ENROLL`, `DEVICE_APPROVAL`).
- `token_hash` (hash do token; o token em texto puro nunca é persistido).
- `status` (`PENDING`, `CONSUMED`, `EXPIRED`, `REVOKED`).
- `expires_at`.
- `consumed_at` (opcional).
- `created_at`.

**Invariantes:**

- O token nunca é armazenado em texto puro — apenas seu hash.
- Cada `MagicLink` é de uso único: uma vez `CONSUMED`, não pode ser
  reutilizado.
- Expiração inicial recomendada para `type = ACTIVATION`: 24 horas (demais
  tipos: Pendente de decisão de prazo específico).
- Um `MagicLink` expirado (`expires_at` no passado) não pode ser consumido,
  independentemente do valor atual de `status`.

**Relacionamentos:**

- Pertence a exatamente uma `Identity`.

**Status conceituais:** `PENDING`, `CONSUMED`, `EXPIRED`, `REVOKED`.

**Eventos de domínio:** `magic-link.created`, `magic-link.consumed`.

**O que não pertence a esta entidade:**

- O conteúdo do e-mail/canal de envio (isso é responsabilidade de um
  serviço de notificação, fora do domínio central).
- Regras de negócio do que acontece após o consumo (por exemplo, criação de
  `Credential` após `ACTIVATION`) — essas regras são orquestradas pelo
  bounded context `security`, mas a entidade `MagicLink` em si apenas
  representa o link.

---

## 11. Session

**Responsabilidade:** representar uma sessão autenticada de uma `Identity`,
auditável e revogável.

**Atributos conceituais:**

- `id` (UUID público).
- `identity_id`.
- `status` (`ACTIVE`, `REVOKED`, `EXPIRED`).
- `created_at`.
- `expires_at`.
- `revoked_at` (opcional).
- `ip_address`, `user_agent` (metadados de auditoria; Pendente de decisão
  sobre retenção e anonimização).

**Invariantes:**

- Uma `Session` só é criada após autenticação bem-sucedida (`Credential`
  válida ou `MagicLink` de tipo compatível consumido).
- `Session` revogada não pode voltar a `ACTIVE`.
- Uma `Identity` pode ter múltiplas `Session` simultâneas (multi-dispositivo
  assumido como padrão; limite, se houver, é Pendente de decisão).

**Relacionamentos:**

- Pertence a exatamente uma `Identity`.
- Está associada a zero ou um `RefreshToken` ativo.

**Status conceituais:** `ACTIVE`, `REVOKED`, `EXPIRED`.

**Eventos de domínio:** `session.created`, `session.revoked`.

**O que não pertence a esta entidade:**

- Regras de autorização local do produto consumidor (a sessão apenas prova
  "quem está autenticado", não "o que pode fazer").

---

## 12. RefreshToken

**Responsabilidade:** permitir a renovação de uma `Session` sem exigir nova
autenticação completa, com rotação para reduzir risco de reuso indevido.

**Atributos conceituais:**

- `id` (UUID público).
- `session_id`.
- `token_hash` (hash do token; nunca texto puro).
- `status` (`ACTIVE`, `ROTATED`, `REVOKED`, `EXPIRED`).
- `expires_at`.
- `created_at`.

**Invariantes:**

- O token nunca é armazenado em texto puro.
- Um `RefreshToken` usado é rotacionado: o uso bem-sucedido invalida o token
  atual (`ROTATED`) e emite um novo.
- Reuso de um `RefreshToken` já rotacionado ou revogado deve ser tratado
  como evento de segurança (mecanismo de detecção Pendente de decisão).

**Relacionamentos:**

- Pertence a exatamente uma `Session`.

**Status conceituais:** `ACTIVE`, `ROTATED`, `REVOKED`, `EXPIRED`.

**Eventos de domínio:** cobertos por `session.created`/`session.revoked`
nesta fase; não possui eventos próprios no MVP.

**O que não pertence a esta entidade:**

- Qualquer dado de autorização — é puramente um mecanismo de continuidade
  de sessão.

---

## 13. AuditEvent

**Responsabilidade:** registrar de forma imutável eventos relevantes de
segurança e administração ocorridos nos demais bounded contexts do
Ingressa.

**Atributos conceituais:**

- `id` (UUID público).
- `event_type` (ex.: `identity.created`, `application-access.granted`).
- `event_version`.
- `entity_type`, `entity_id` (referência ao objeto afetado, por UUID
  público).
- `actor_identity_id` (opcional — quem realizou a ação; pode ser nulo para
  ações do sistema).
- `payload` (dados mínimos do evento, nunca dados sensíveis — ver Catálogo
  de Eventos).
- `occurred_at`.

**Invariantes:**

- `AuditEvent` é somente-append: nunca é atualizado ou apagado após
  criação.
- `payload` nunca contém senha, hash de token em texto reversível, ou
  qualquer dado classificado como sensível pelo Catálogo de Eventos.

**Relacionamentos:**

- Referencia conceitualmente qualquer entidade do domínio, por
  `entity_type` + `entity_id`.

**Status conceituais:** não aplicável (evento imutável, sem ciclo de vida).

**Eventos de domínio:** não aplicável (é o próprio mecanismo de auditoria).

**O que não pertence a esta entidade:**

- Log técnico de aplicação (erro, performance) — isso é observabilidade
  técnica, não auditoria de domínio.
- Dados de auditoria de negócio de produtos consumidores.

---

## Questões pendentes de decisão (consolidado)

- Se `Membership` e `ApplicationAccess` referenciam `IdentityProfile`
  diretamente ou `Identity` de forma perfil-agnóstica.
- Se `SERVICE_ACCOUNT` entra no MVP como valor válido de `Profile`.
- Algoritmo de hash de senha e de token.
- Prazos de expiração para tipos de `MagicLink` além de `ACTIVATION`.
- Política de limite de sessões simultâneas por identidade.
- Mecanismo de detecção de reuso indevido de `RefreshToken`.
- Retenção e eventual anonimização de `ip_address`/`user_agent` em
  `Session`.
- Onde armazenar metadados técnicos de integração de `Application`
  (endpoints, segredos de integração).
