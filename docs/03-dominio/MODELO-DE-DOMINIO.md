# Modelo de Domínio — PCTEC Ingressa

Versão associada: v0.2.0 — Domain Foundation (entidade `Identity`
atualizada pela v0.3.0 — Identity Core; entidade `IdentityProfile` removida
por ADR-025, ver nota na seção 2)
Status: Proposto para revisão do Product Owner e do Platform Architect

Este documento substitui e expande a versão anterior deste arquivo (v0.1.0),
que continha apenas uma listagem resumida de entidades. Nenhuma decisão
anterior foi contrariada; as entidades `Role` e `Permission` citadas na
versão anterior foram reformuladas como `Profile` + `ApplicationAccess`,
conforme ADR-007 (autorização em duas camadas) — não existe autorização
fina de negócio no Ingressa, portanto não há um par genérico Role/Permission
no núcleo do domínio.

**Nota de correção (ADR-025, v0.3.0):** `IdentityProfile` foi removida como
entidade do bounded context `identity`. As classificações relacionais
`EMPLOYEE`, `CUSTOMER`, `PARTNER`, `SUPPLIER` pertencem ao contexto do
`Membership`, sob o nome provisório `MembershipProfile` — modelagem
definitiva fora do escopo desta entrega. `Membership` e `ApplicationAccess`
referenciam `Identity` diretamente, não mais `IdentityProfile`. Ver seção 2
para detalhes desta correção.

Convenção adotada: nomes de entidade, atributo e evento em inglês; texto
explicativo em português.

## Índice de entidades

1. Identity
2. ~~IdentityProfile~~ (removida — ADR-025; ver seção 2)
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

**Responsabilidade:** representar univocamente uma entidade digital
reconhecida pela Plataforma PCTEC. É a raiz de identidade — tudo que se
refere a "quem é reconhecido pela plataforma" converge para uma única
`Identity`. Apenas o subtipo `HUMAN` é implementado no primeiro escopo
funcional (ADR-018); os demais tipos (`SERVICE`, `APPLICATION`, `DEVICE`,
`AGENT`) são reservados.

> Especificação detalhada (Aggregate Root completo, Value Objects,
> comandos, eventos, máquina de estados, invariantes, casos de uso): ver
> `docs/03-dominio/IDENTITY-DOMAIN-DESIGN.md` e
> `docs/03-dominio/IDENTITY-UBIQUITOUS-LANGUAGE.md` (v0.3.0). Esta seção
> mantém apenas o resumo consistente com aquela especificação.

**Nota de correção de nomenclatura (v0.3.0 — ADR-021):** a partir desta
revisão, para a entidade `Identity` especificamente, `id` passa a se
referir ao identificador **interno** (`BIGINT UNSIGNED`) e `public_id` ao
identificador **externo** (UUID textual, `CHAR(36)`) — o inverso do que a
v0.2.0 havia nomeado (`id` como UUID público, `internal_id` como interno).
Esta correção é restrita à entidade `Identity`; as demais entidades deste
documento mantêm a convenção original da v0.2.0 até uma eventual revisão de
consistência de plataforma (ver ADR-021, seção Consequências).

**Atributos conceituais:**

- `id` (interno, `BIGINT UNSIGNED`, nunca exposto em API, evento ou log de
  consumidor — ADR-021).
- `public_id` (UUID textual, `CHAR(36)`, imutável, identificador externo —
  ADR-021).
- `type` (`IdentityType`: `HUMAN`, `SERVICE`, `APPLICATION`, `DEVICE`,
  `AGENT`; apenas `HUMAN` implementado no MVP — ADR-018).
- `full_name`.
- `email` (único globalmente, case-insensitive), `email_normalized`.
- `cpf` (opcional, normalizado quando informado como `cpf_normalized`).
- `status` (`PENDING`, `ACTIVE`, `BLOCKED`, `INACTIVE`, `DELETED` —
  ADR-019).
- `login_enabled` (booleano, independente de `status`).
- `created_at`, `created_by_identity_public_id`, `updated_at`,
  `updated_by_identity_public_id`.
- `deleted_at`, `deleted_by_identity_public_id`, `deletion_reason`
  (preenchidos apenas quando `status = DELETED` — ADR-020).
- `version` (controle de concorrência otimista — ADR-024).

**Invariantes:**

- Uma pessoa possui exatamente uma `Identity` do tipo `HUMAN`.
- `email` é obrigatório no cadastro e único globalmente, comparado de forma
  case-insensitive.
- Existe apenas um `email` por identidade no MVP (sem múltiplos e-mails).
- `cpf` é opcional; quando informado, deve ser normalizado (apenas
  dígitos) e ser único entre as identidades que o informaram.
- `login_enabled = true` não é automático a partir de `status = ACTIVE`; são
  dimensões independentes. Uma identidade pode existir, estar `ACTIVE` e
  ainda assim não estar habilitada para login (por exemplo, um cliente
  cadastrado por um vínculo comercial que ainda não deve acessar sistemas).
- Autenticação só é permitida com `status = ACTIVE` **e**
  `login_enabled = true` simultaneamente; `BLOCKED` sempre impede
  autenticação, independentemente de `login_enabled`.
- `public_id` nunca muda após a criação; `id` interno nunca é exposto.
- `status = DELETED` é terminal — sem transição operacional de volta pelo
  fluxo comum (ADR-019, ADR-020).
- Detalhamento completo de invariantes, comandos e regras de erro: ver
  `IDENTITY-DOMAIN-DESIGN.md`.

**Relacionamentos:**

- Uma `Identity` possui zero ou mais `Membership` (o `Membership`, não a
  `Identity`, carrega a classificação relacional `EMPLOYEE`/`CUSTOMER`/
  `PARTNER`/`SUPPLIER` — ADR-025).
- Uma `Identity` referencia (não compõe) zero ou mais `Credential`, por
  `public_id` — `Credential` é agregado próprio do bounded context
  `security`, não filha interna do agregado `Identity` (ADR-017,
  ADR-022).
- Uma `Identity` referencia, pelo mesmo princípio, zero ou mais `Session` e
  pode ser alvo de zero ou mais `MagicLink`.

**Status conceituais:**

- `PENDING`: identidade criada, aguardando ativação.
- `ACTIVE`: identidade ativa e utilizável conforme `login_enabled`.
- `BLOCKED`: identidade bloqueada administrativamente ou por segurança.
- `INACTIVE`: identidade desativada (ex.: desligamento, encerramento de
  relação comercial).
- `DELETED`: exclusão lógica, estado terminal (ADR-019, ADR-020).

**Eventos de domínio:** `identity.created`, `identity.name-updated`,
`identity.email-change-requested`, `identity.email-changed`,
`identity.login-enabled`, `identity.login-disabled`, `identity.activated`,
`identity.blocked`, `identity.unblocked`, `identity.inactivated`,
`identity.reactivated`, `identity.deleted`, `identity.anonymized`. Lista
completa com payloads: `CATALOGO-DE-EVENTOS.md` e
`IDENTITY-DOMAIN-DESIGN.md`, seção 9. (`identity.profile-added` e
`identity.profile-removed` foram removidos por ADR-025 — não pertencem a
`Identity`.)

**O que não pertence a esta entidade:**

- Papel de negócio dentro de um produto consumidor (isso é responsabilidade
  do produto consumidor).
- Vínculo organizacional (isso é `Membership`).
- Classificação relacional `EMPLOYEE`/`CUSTOMER`/`PARTNER`/`SUPPLIER` (isso
  é `MembershipProfile`, associado ao `Membership` — ADR-025).
- Mecanismo de autenticação — senha, hash, salt (isso é `Credential`,
  bounded context `security`; ver ADR-022).
- Sessão e refresh token (isso é `Session`/`RefreshToken`, `security`).
- Telefone, endereço, foto, cargo, preferências (não incluídos sem decisão
  formal — ver `IDENTITY-DOMAIN-DESIGN.md`, seção 15).

---

## 2. ~~IdentityProfile~~ (removida — ADR-025)

**Nota de correção (v0.3.0 — ADR-025):** esta entidade foi removida do
domínio `identity`. A responsabilidade descrita abaixo (histórico, v0.2.0)
foi reavaliada: `EMPLOYEE`, `CUSTOMER`, `PARTNER` e `SUPPLIER` não são
características intrínsecas de uma `Identity` — dependem da relação entre a
`Identity` e uma `Organization` específica (a mesma `Identity` pode ser
`EMPLOYEE` na Organização A e `CUSTOMER` na Organização B). Essa
classificação passa a pertencer ao contexto do `Membership`, sob o nome
provisório `MembershipProfile`, com modelagem definitiva a ser detalhada em
entrega própria do bounded context `organization`/`access` — fora do
escopo desta entrega. `Membership` e `ApplicationAccess` referenciam
`Identity` diretamente, não mais `IdentityProfile` (ver seções 5 e 8
abaixo, já atualizadas).

Conteúdo histórico preservado apenas para registro de como a entidade foi
originalmente proposta (v0.2.0), não é mais vigente:

<details>
<summary>Versão histórica (v0.2.0, não vigente)</summary>

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

</details>

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

**Responsabilidade:** representar o vínculo de uma `Identity` com uma
`Organization`, incluindo a classificação relacional desse vínculo
(`EMPLOYEE`, `CUSTOMER`, `PARTNER`, `SUPPLIER`).

**Nota de correção (v0.3.0 — ADR-025):** `Membership` referencia `Identity`
diretamente, não `IdentityProfile` (entidade removida). A classificação
antes proposta como `IdentityProfile` passa a ser um atributo/conceito
associado ao próprio `Membership`, sob o nome provisório
`MembershipProfile` — modelagem definitiva (se será atributo simples ou
entidade própria, com que invariantes) fica para revisão futura deste
bounded context, fora do escopo desta correção.

**Atributos conceituais:**

- `id` (UUID público).
- `identity_id`.
- `organization_id`.
- `profile` (classificação relacional: `EMPLOYEE`, `CUSTOMER`, `PARTNER`,
  `SUPPLIER`; modelagem definitiva — atributo simples vs. entidade
  `MembershipProfile` própria — Pendente de decisão, ADR-025).
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
  inclusive em organizações diferentes e com classificações relacionais
  diferentes (ex.: `EMPLOYEE` na Organização A, `CUSTOMER` na Organização
  B).
- Não deve haver dois `Membership` ativos idênticos (mesma identidade,
  mesma organização, mesma classificação relacional).

**Relacionamentos:**

- Pertence a uma `Identity` (referência direta, por `public_id`/`id`
  interno — ADR-025).
- Referencia uma `Organization`.

**Status conceituais:** `ACTIVE`, `INACTIVE`.

**Eventos de domínio:** `membership.created`, `membership.updated`.

**O que não pertence a esta entidade:**

- Papéis operacionais dentro da organização (cargo, centro de custo) — fora
  do MVP.
- Acesso a aplicações (isso é `ApplicationAccess`).

**Pendente de decisão:** modelagem definitiva de `MembershipProfile`
(atributo simples em `Membership` vs. entidade própria com ciclo de vida) —
a ser detalhada em entrega própria do bounded context
`organization`/`access` (ADR-025). Esta entrega apenas resolve que a
classificação pertence ao `Membership`, não à `Identity`.

---

## 6. Profile

**Responsabilidade:** enum de domínio que representa as classificações
relacionais possíveis de um vínculo `Membership` entre `Identity` e
`Organization`.

**Nota de correção (v0.3.0 — ADR-025):** este enum não é mais referenciado
por `IdentityProfile` (entidade removida) — é atributo/conceito do
`Membership` (ver seção 5).

**Atributos conceituais (valores do enum):**

- `EMPLOYEE`.
- `CUSTOMER`.
- `PARTNER`.
- `SUPPLIER`.
- `SERVICE_ACCOUNT` (futuro — Pendente de decisão sobre entrada no MVP).

**Invariantes:**

- `Profile` é um tipo de valor (enum); não é atributo de `Identity`, é
  atributo do vínculo `Membership` (ADR-025).

**Relacionamentos:**

- Referenciado por `Membership` (seção 5).

**Status conceituais:** não aplicável (é um enum).

**Eventos de domínio:** não aplicável diretamente; mudanças de
classificação relacional são capturadas via `membership.updated`.

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
global de uma `Identity` a uma `Application`.

**Nota de correção (v0.3.0 — ADR-025):** `ApplicationAccess` referencia
`Identity` diretamente, não `IdentityProfile` (entidade removida). Caso uma
concessão de acesso precise ser sensível a contexto organizacional/
classificação relacional no futuro, isso será modelado via `Membership`/
`MembershipProfile`, não reintroduzindo `IdentityProfile`.

**Nota de correção (v0.5.0 — ADR-028):** adicionado o atributo
`access_profile`, implementado nesta versão. Distingue **nível de acesso
GLOBAL à própria aplicação** (ex.: administração da plataforma Ingressa
como um todo) — não é permissão fina de negócio de um produto consumidor
(continua vedado pelo invariante abaixo). Enum fechado, hoje só com o
valor `ADMIN`.

**Atributos conceituais:**

- `id` (UUID público).
- `identity_id`.
- `application_id`.
- `access_profile` (enum fechado — `ADMIN` nesta versão; novos valores
  exigem decisão formal e `ALTER TABLE`, ADR-028).
- `status` (`GRANTED`, `REVOKED`).
- `granted_at`, `revoked_at` (opcional).
- `granted_by` (referência à `Identity` que concedeu — `NULL` quando não
  há Actor autenticado real, ex.: bootstrap administrativo, ADR-028;
  nunca um marcador fingindo ser um `public_id`).
- `created_at`, `updated_at`.

**Invariantes:**

- Não deve haver dois registros `ApplicationAccess` com `status = GRANTED`
  para a mesma combinação de identidade, aplicação e `access_profile`.
- Revogar acesso não apaga o histórico; cria um novo estado (`REVOKED`) ou
  atualiza o registro preservando `granted_at`/`revoked_at` para fins de
  auditoria.
- `ApplicationAccess` nunca contém regras de permissão fina de negócio de
  um produto consumidor — apenas entra/não entra, e com que nível de
  acesso *global* à aplicação (ADR-028). `access_profile` não é uma
  matriz de permissões.

**Relacionamentos:**

- Referencia `Identity` diretamente.
- Referencia `Application`.

**Status conceituais:** `GRANTED`, `REVOKED`.

**Eventos de domínio:** `application-access.granted`,
`application-access.revoked`.

**O que não pertence a esta entidade:**

- Qualquer decisão sobre o que o usuário pode fazer dentro do produto.
- Permissões finas por funcionalidade — `access_profile` é uma
  classificação global fechada (enum pequeno), nunca um campo de
  permissão granular por ação.

---

## 9. Credential

**Responsabilidade:** representar o mecanismo de autenticação de uma
`Identity`. No MVP, exclusivamente credencial local (senha).

**Nota de correção (v0.5.x — ADR-029, revisão crítica):** modelo revisado
com as decisões formais da Fase C (ADR-027), incluindo correções feitas
em uma segunda rodada de revisão crítica antes do commit. `loginIdentifier`
foi avaliado e **não** adotado — o identificador de login é sempre
resolvido via `Identity.email_normalized`, nunca duplicado em
`Credential`. Adicionados `version` (optimistic locking, ADR-024, por
consistência com as demais entidades já implementadas) e
`last_authenticated_at` (reservado para a Fase D — login real; não
populado por nenhum comando desta fase). `failedAttempts`/`lockedUntil`
foram avaliados e **deferidos** explicitamente (lockout fica para uma
entrega própria — ver ADR-029, seção "Lockout"; quando implementado,
`lockedUntil` é um campo temporal na própria linha, nunca um valor de
`status`). `status` permanece fechado em `ACTIVE`/`REVOKED` — `PENDING`,
`LOCKED` e `DISABLED` foram avaliados e explicitamente rejeitados como
valores de `status` (ver ADR-029, "Status de Credential"). A criação da
primeira credencial é uma exceção de bootstrap **global** (não vinculada
a nenhuma Identity específica, nem hardcoded) — ver ADR-029, "Escopo
exato do bootstrap".

**Atributos conceituais:**

- `id` (UUID público).
- `identity_id`.
- `type` (`LOCAL_PASSWORD`; outros tipos são futuros e não fazem parte do
  MVP — ex.: um provedor externo como `MICROSOFT_ENTRA`, sem quebrar
  `Identity`).
- `password_hash` (nunca texto puro; algoritmo Argon2id — ADR-029).
- `status` (`ACTIVE`, `REVOKED`).
- `last_authenticated_at` (opcional; populado apenas na Fase D).
- `version` (optimistic locking).
- `last_changed_at`.
- `created_at`, `updated_at`.

**Invariantes:**

- Senha nunca é armazenada, logada ou trafegada em texto puro em nenhuma
  camada do domínio.
- Não existe senha provisória: a primeira credencial é criada por um
  bootstrap explícito e auditável (exceção formalizada em ADR-029); toda
  `Credential` subsequente nasce por `MagicLink` do tipo `ACTIVATION`
  consumido com sucesso (regra geral, ADR-022).
- Existe no máximo **uma linha** de `Credential` por combinação
  `(identity, type)`, para sempre — garantida por `UNIQUE` de banco
  (`UNIQUE(identity_public_id, type)`), não apenas por checagem
  transacional. Rotação de senha é `UPDATE` na mesma linha (`password_hash`,
  `version += 1`), nunca um novo `INSERT` (revisão crítica de ADR-029,
  "Rotação de senha e unicidade" — corrige a versão anterior deste
  documento, que descrevia a unicidade como dependente apenas de
  checagem transacional).

**Relacionamentos:**

- Pertence a exatamente uma `Identity`, referenciada por `public_id`
  (mesmo padrão de `ApplicationAccess`, ADR-025/028).

**Status conceituais:** `ACTIVE`, `REVOKED`.

**Eventos de domínio:** `credential.created` (nova credencial —
formalizado em ADR-029), `credential.changed` (alterações futuras a uma
credencial existente, ex.: troca de senha — não implementado ainda).

**O que não pertence a esta entidade:**

- Algoritmo de hash específico como decisão de implementação de biblioteca
  (a família do algoritmo — Argon2id — já é decisão arquitetural fechada
  em ADR-029; a biblioteca concreta permanece Pendente de decisão).
- MFA (previsto no modelo por meio do tipo `MFA_ENROLL` de `MagicLink`, mas
  o mecanismo de segundo fator em si é Pendente de decisão).
- `loginIdentifier` — nunca duplicado aqui; sempre resolvido via
  `Identity.email_normalized` (ADR-029).

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

- **(Resolvida por ADR-025 — v0.3.0)** `Membership` e `ApplicationAccess`
  referenciam `Identity` diretamente. `IdentityProfile` foi removida; a
  classificação relacional (`EMPLOYEE`/`CUSTOMER`/`PARTNER`/`SUPPLIER`)
  pertence ao `Membership`.
- Modelagem definitiva de `MembershipProfile` (atributo simples em
  `Membership` vs. entidade própria, invariantes, ciclo de vida) — a ser
  detalhada em entrega própria do bounded context `organization`/`access`
  (ADR-025).
- Se `SERVICE_ACCOUNT` entra no MVP como valor válido de `Profile`.
- Algoritmo de hash de senha e de token.
- Prazos de expiração para tipos de `MagicLink` além de `ACTIVATION`.
- Política de limite de sessões simultâneas por identidade.
- Mecanismo de detecção de reuso indevido de `RefreshToken`.
- Retenção e eventual anonimização de `ip_address`/`user_agent` em
  `Session`.
- Onde armazenar metadados técnicos de integração de `Application`
  (endpoints, segredos de integração).
