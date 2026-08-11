# ADR-032 — AccessProfile ganha USER, para acesso comum a aplicações consumidoras

## Contexto

G3 precisa que `ApplicationAccess` responda "esta Identity pode usar
`PCTEC_PORTAL`?" — mas `AccessProfile` (ADR-028, Fase F) é hoje um enum
fechado com **exclusivamente `ADMIN`**, tanto no Value Object
(`ACCESS_PROFILES = ["ADMIN"]`) quanto na coluna do banco
(`application_accesses.access_profile ENUM('ADMIN')`). Um usuário comum
do Portal não é administrador de nada — usar `ADMIN` para representar
"pode entrar no Portal normalmente" seria semanticamente incorreto e
confundiria com administração de plataforma.

ADR-028 já previa exatamente esta situação, explicitamente: *"Novos
perfis exigem nova decisão formal (extensão do Value Object + `ALTER
TABLE` na coluna `ENUM('ADMIN')` de `application_accesses`), nunca uma
string arbitrária aceita silenciosamente."* Esta ADR é essa decisão
formal.

## Decisão

1. `AccessProfile` ganha um segundo valor: **`USER`**. Representa "acesso
   comum a uma aplicação consumidora" — a mesma distinção
   "administração da plataforma ou uso comum" que a própria ADR-028 já
   registrava em prosa na tabela de responsabilidades, agora com um
   segundo valor formal em vez de só `ADMIN` vs. ausência de acesso.
2. `accessProfile = USER` continua sendo uma distinção de nível de
   acesso GLOBAL à aplicação (ADR-007) — não decide nada sobre o que a
   Identity pode fazer dentro do produto consumidor. Um usuário `USER`
   do Portal ainda precisa de `Membership` (ADR-031) para ter qualquer
   escopo comercial — `ApplicationAccess(PCTEC_PORTAL, USER, GRANTED)`
   só responde "pode entrar", nunca "o que pode ver".
3. Migration nova (`0015_add_user_access_profile`) altera
   `application_accesses.access_profile` de `ENUM('ADMIN')` para
   `ENUM('ADMIN','USER')` — não modifica `0006` (já aplicada no DEV).
4. `PCTEC_INGRESSA` continua exigindo `ADMIN` (nenhuma mudança de
   comportamento para a Fase F já homologada). `PCTEC_PORTAL` exige
   `USER` — usuários comuns do Portal nunca recebem `ADMIN` de
   `PCTEC_INGRESSA` automaticamente, nem o inverso (ADR-031 §6, reforçado
   aqui): `ApplicationAccess` é por aplicação, `ADMIN` de uma não implica
   nada sobre outra.

## Consequências

- `ACCESS_PROFILES` deixa de ser um array de um elemento só — qualquer
  código que assumia implicitamente "só existe ADMIN" (nenhum
  encontrado nesta auditoria) precisaria ser revisado; não havia.
- Testes de `AccessProfile`/`AuthorizeApplicationAccessService`
  existentes continuam válidos (cobrem `ADMIN`, que não mudou de
  comportamento); novos testes cobrem `USER`.
- Terceiro perfil futuro (se necessário) segue o mesmo processo: ADR
  nova + extensão do Value Object + `ALTER TABLE` incremental — nunca
  string livre.

## Decisão adicional (revisão pré-commit de G3): USER × ADMIN não têm hierarquia automática

**Fechado explicitamente, decisão B do prompt de revisão:**
`GET /api/v1/portal/context` exige EXATAMENTE `accessProfile = USER`.
Um `ApplicationAccess(PCTEC_PORTAL, ADMIN, GRANTED)` **não implica**
`USER` — `AuthorizeApplicationAccessService` já checa igualdade exata
(`accessProfile.equals(requiredProfile)`, Fase F, nunca alterado por
esta ADR), então isso já era o comportamento real do código; esta seção
só torna a decisão explícita e testada, em vez de deixá-la implícita.

**Por que não `ADMIN > USER` automático:** `accessProfile = ADMIN` em
`PCTEC_PORTAL` representaria, conceitualmente, um administrador da
própria aplicação Portal (ex.: equipe PCTEC que configura/mantém o
Portal) — não um usuário final com contexto organizacional. Inferir
"ADMIN pode tudo que USER pode" introduziria uma hierarquia implícita
que este projeto explicitamente evita (mesmo princípio de
`AccessProfile` ser um conjunto fechado, sem herança, desde ADR-028).
Se uma pessoa precisar tanto administrar o Portal quanto ver
`PortalContext` como usuário comum, ela recebe **duas concessões
independentes** (`ADMIN` e `USER`, duas linhas em `application_accesses`
— possível porque `uk_app_access_identity_app_profile` de 0006 é por
`(identity, application, profile)`, não por `(identity, application)`).

**Reafirmado, sem exceção:** `ApplicationAccess(PCTEC_INGRESSA, ADMIN)`
continua irrelevante para `PCTEC_PORTAL` — os dois eixos (aplicações
diferentes) já eram independentes (ADR-031 §6) e esta ADR não muda isso.

## Status

Aprovada — implementação em G3 (v0.6.x).
