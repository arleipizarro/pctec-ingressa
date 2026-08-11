# Organization / Membership / PortalContext — Design (Fase G)

Complementa ADR-031. Este documento detalha o modelo técnico; a ADR
registra a decisão de propriedade. Nenhum código, migration ou seed é
criado nesta entrega.

---

## 1. Organization

Já desenhado em `MODELO-DE-DOMINIO.md` §3 e `MODELO-RELACIONAL-PROPOSTO.md`
§3 (v0.2.0). Confirmado nesta fase, sem alteração de forma:

| Coluna | Tipo | Observações |
|---|---|---|
| internal_id | BIGINT UNSIGNED AUTO_INCREMENT | PK interna, nunca exposta |
| public_id | CHAR(36) | UUID público — contrato cross-system |
| type | ENUM('BUSINESS_GROUP','COMPANY') | ver §3 |
| legal_name | VARCHAR(255) | |
| trade_name | VARCHAR(255) | opcional |
| document_number | VARCHAR(20) | CNPJ normalizado, único por `type` |
| status | ENUM('ACTIVE','INACTIVE') | |

A PCTEC (empresa proprietária dos produtos) também é modelada como uma
`Organization` do tipo `COMPANY`, sem `OrganizationRelationship` de grupo
— é o "tenant" ao qual colaboradores internos (`profile=EMPLOYEE`) se
vinculam.

## 2. Tipos: GROUP e COMPANY

Sim — `type` já cobre isso (`BUSINESS_GROUP`, `COMPANY`). Não se cria um
terceiro tipo. Uma filial/departamento/unidade operacional continua fora
do MVP (já registrado como fora de escopo em `MODELO-DE-DOMINIO.md`).

**Revisão do Product Owner — `document_number` para `BUSINESS_GROUP`:**

- `BUSINESS_GROUP.document_number` **pode ser `NULL`**. Um grupo
  comercial (ex.: "Grupo Primavera", com empresas A/B/C sob CNPJs
  distintos) frequentemente não possui CNPJ próprio — não se força
  preenchimento.
- A unicidade de `document_number` por `type` (já registrada em
  `MODELO-RELACIONAL-PROPOSTO.md` como `uk_organizations_document_type`)
  aplica-se **somente a valores não nulos** — múltiplos `BUSINESS_GROUP`
  com `document_number = NULL` coexistem sem violar a constraint (padrão
  MariaDB para `UNIQUE` com `NULL`).
- Um `BUSINESS_GROUP` **nunca herda artificialmente** o CNPJ de uma
  `COMPANY` filha. Não se inventa nem se copia documento de grupo a
  partir de empresa — se o grupo não tem CNPJ próprio, o campo fica
  `NULL`, ponto final.

## 3. Hierarquia grupo → empresas

Via `OrganizationRelationship` (`MODELO-DE-DOMINIO.md` §4,
`MODELO-RELACIONAL-PROPOSTO.md` §4):

- `parent_organization` deve ser `BUSINESS_GROUP`.
- `child_organization` deve ser `COMPANY`.
- Uma `COMPANY` pertence a **no máximo um** `BUSINESS_GROUP` no MVP
  (`uk_org_rel_child`), sem ciclos.
- Validação de tipo é responsabilidade da camada de aplicação (MariaDB
  não expressa isso nativamente sem trigger, e trigger não está aprovado
  nesta fase — igual à decisão já registrada para este mesmo modelo).

## 4. Membership e cardinalidade

`Membership` vincula `Identity` ↔ `Organization`, com `profile`
(`EMPLOYEE`, `CUSTOMER`, `PARTNER`, `SUPPLIER`, `SERVICE_ACCOUNT` —
ADR-025) e `scope` (`ORGANIZATION_ONLY` | `ORGANIZATION_AND_DESCENDANTS`).

**Cardinalidade: uma `Identity` pode ter N `Membership`s ativos
simultaneamente.** Casos cobertos:

- Usuário de empresa única → 1 Membership.
- Grupo com várias CNPJs → 1 Membership no `BUSINESS_GROUP` com
  `scope=ORGANIZATION_AND_DESCENDANTS` cobre todas as `COMPANY` do grupo;
  não é necessário 1 Membership por empresa filha.
- Usuário que acessa várias empresas não relacionadas por grupo →
  N Memberships, um por `COMPANY`.
- Consultor que atende vários grupos → N Memberships, um por
  `BUSINESS_GROUP` (cada um com seu `scope=..._AND_DESCENDANTS`).
- Colaborador PCTEC → Membership `profile=EMPLOYEE` na `Organization`
  PCTEC.
- ADMIN do Ingressa → **não é modelado como Membership.** É
  `ApplicationAccess(PCTEC_INGRESSA, ADMIN)`, ortogonal (ver ADR-031 §6-7).
- Usuário temporário → Membership com `status=ACTIVE`/`INACTIVE` e
  `started_at`/`ended_at`, já previstos na tabela; revogação é
  encerrar o Membership (`ended_at`), não deletar.
- Troca de grupo/empresa → não remove Memberships antigos; apenas muda
  qual é o **contexto ativo** da sessão (§7).

**Decisão fechada sobre reativação (revisão do Product Owner, antes do
commit de G2):** se um vínculo encerrado (mesma `identity` + `organization`
+ `profile`) precisar voltar a ficar ativo, isso **reativa a mesma
linha** (`status=ACTIVE`, `ended_at=NULL` de novo, `version` incrementada)
— nunca cria uma segunda linha. Essa é a razão de
`uk_membership_unique` não ser condicionada a `status`: há sempre, no
máximo, uma linha por classificação, para sempre, então a constraint
nunca entra em tensão com o lifecycle planejado. `end()`/`reactivate()`
são comandos futuros (fora de escopo G2), mas o schema já é compatível
com eles sem qualquer migration adicional.

Unicidade: `uk_membership_unique (identity_public_id,
organization_public_id, profile)` garante no máximo uma linha por
classificação, independente de status — já coberto no desenho
relacional existente e fechado pela decisão acima.

### 4.1 `Membership.profile` — relação, não autorização

**Revisão do Product Owner:** `profile` responde *"com qual organização
essa Identity possui relação, e qual o alcance organizacional dessa
relação?"* — nunca *"quais operações ela pode executar?"*.
`CUSTOMER`/`EMPLOYEE`/`PARTNER`/`SUPPLIER` são classificações
relacionais (ADR-025 já estabeleceu isso para o vínculo em si; esta
revisão fecha a semântica de uso). Interpretações do tipo
"`CUSTOMER` = pode ver contratos" ou "`EMPLOYEE` = pode ver tudo" **não
devem ser implementadas** — isso seria misturar `Membership` com
autorização funcional, que continua sendo responsabilidade de uma camada
própria (fora do escopo desta fase), do mesmo jeito que
`ApplicationAccess` já é hoje independente de `Membership` (ADR-031 §6).

## 5. Usuário externo × colaborador PCTEC × ADMIN do Ingressa

| | Como é identificado | Concede acesso a quê |
|---|---|---|
| Usuário externo | `Membership` com `profile` comercial (`CUSTOMER`/`PARTNER`/`SUPPLIER`) em uma ou mais `Organization` | Escopo comercial dessas `Organization`s, via `PortalContext` |
| Colaborador PCTEC | `Membership` com `profile=EMPLOYEE` na `Organization` PCTEC | Nada comercial por si só — só marca vínculo empregatício |
| ADMIN do Ingressa | `ApplicationAccess(PCTEC_INGRESSA, ADMIN)` | Administração do próprio Ingressa (gestão de Identity, Application, ApplicationAccess) — **nunca** dados comerciais de clientes |

A separação do item 6 da ADR-031 é o que impede que um ADMIN do
Ingressa, ou um colaborador PCTEC, enxergue automaticamente dados de
todos os clientes do Portal — ele precisaria de um `Membership`
comercial explícito para isso, exatamente como qualquer outro usuário.

## 6. Escolha de contexto ativo (múltiplos Memberships)

**Revisão do Product Owner: o frontend nunca é autoridade sobre contexto
ativo.** Não existe "contexto autorizado do frontend" — existe apenas
uma *seleção* do frontend, que o backend prova novamente em cada
boundary relevante. Fluxo fechado:

```
GET /api/v1/portal/context
        ↓
lista de Organizations permitidas (todos os Memberships ACTIVE)
        ↓
usuário seleciona uma Organization na UI
        ↓
frontend envia organizationPublicId em cada chamada seguinte
        ↓
backend recalcula/prova: Identity → Membership → Organization
        ↓
operação autorizada (ou 403, se a prova falhar)
```

O browser pode lembrar a seleção (conveniência de UX), mas isso não
substitui a revalidação. Não se persiste "contexto ativo" na `Session`
nesta fase — cada chamada é independentemente provada contra
`Membership`, via o middleware descrito em §8. Se a `Identity` tem
exatamente 1 Membership ativo, a seleção é trivial (não há ambiguidade
a resolver), mas a prova no backend continua acontecendo do mesmo jeito.

## 7. `GetPortalContextService` / `GET /api/v1/portal/context`

Fluxo:

```
AuthenticatedPrincipal (identityPublicId, sessionPublicId)
  → requireApplicationAccess(PCTEC_PORTAL)   [reusa o mecanismo da Fase F]
  → busca todos os Membership ACTIVE da Identity
  → para cada Membership, resolve a Organization (e, se BUSINESS_GROUP
    com scope AND_DESCENDANTS, resolve as COMPANY descendentes via
    OrganizationRelationship)
  → devolve lista de Organizations acessíveis
```

Contrato de resposta (minimiza dados — sem CNPJ/documento se o frontend
não precisar, replicando a diretriz já registrada no rascunho original):

```json
{
  "identity": { "publicId": "..." },
  "organizations": [
    {
      "publicId": "...",
      "type": "COMPANY",
      "name": "...",
      "profile": "CUSTOMER"
    }
  ]
}
```

Sem sessão válida: `401 SESSION_INVALID` (contrato já consolidado).
Sessão válida sem `ApplicationAccess(PCTEC_PORTAL)`: `403
APPLICATION_ACCESS_DENIED` (mesmo padrão de `Fase F`).
Sessão e acesso válidos mas zero Membership: `200` com `organizations: []`
— não é erro, é um estado legítimo (ex.: acabou de ganhar acesso ao
Portal mas ainda não foi vinculado a nenhum cliente).

## 8. Impedir acesso a `customerPublicId` fora do contexto autorizado

Regra dura, sem exceção: **toda rota que recebe um `customerPublicId`
(ou equivalente) do frontend deve provar, no backend, que**
`customerPublicId ∈ PortalContext(identity)` **antes de consultar
qualquer dado.** Nunca confiar no valor enviado pelo cliente HTTP. Na
prática:

1. Middleware `requireOrganizationAccess(organizationPublicId)` (nome
   provisório, a implementar em entrega futura) recebe o `publicId` da
   rota/query, resolve os Memberships ativos da `Identity` (já obtidos
   por `GetPortalContextService` ou recalculados), e verifica
   pertencimento — incluindo o caso de `scope=ORGANIZATION_AND_DESCENDANTS`
   (uma COMPANY filha de um grupo autorizado também é válida).
2. Falha de pertencimento → `403`, mesma classificação `AUTHORIZATION`
   já usada em `APPLICATION_ACCESS_DENIED`, com um código próprio (ex.:
   `MEMBERSHIP_SCOPE_DENIED`) a formalizar quando este middleware for
   implementado.
3. Este padrão já existe informalmente e corretamente no Portal atual
   (`contratos.js`: `WHERE c.cliente_id = ? [req.user.cliente_id]`) e no
   Helpdesk (`WHERE t.client_id = ? [req.user.client_id]` quando
   `role='cliente'`) — a mudança na Fase G é migrar esse `cliente_id`
   local para `organizationPublicId` validado contra `Membership`, sem
   perder a disciplina que ambos já demonstram.

## 9. Plano de migração progressiva (sem migration/código nesta entrega)

### 9.1 `OrganizationExternalReference` — domínio de integração, não tabela de apoio

**Revisão do Product Owner:** esta entidade será a ponte de
rastreabilidade de toda a migração pelos próximos anos — precisa de
identidade própria, `status` e timestamps, não só colunas de mapeamento:

```
OrganizationExternalReference
  id                    BIGINT UNSIGNED AUTO_INCREMENT   -- PK interna
  public_id             CHAR(36)                          -- identidade própria (ADR-021)
  organization_public_id CHAR(36)   -- FK conceitual → organizations.public_id
  system_code           VARCHAR     -- 'PCTEC_HUB' | 'PCTEC_PORTAL' | 'PCTEC_HELPDESK'
  entity_type            VARCHAR    -- 'clientes' | 'clientes_grupo' | 'clients' | ...
  legacy_id              BIGINT     -- id INT/BIGINT local do sistema legado
  status                 ENUM('ACTIVE','SUPERSEDED')   -- ver nota abaixo
  created_at              DATETIME
  updated_at              DATETIME
```

**Invariante — versão final, fechada na revisão do Product Owner antes
do commit de G2 (duas correções em sequência sobre a primeira versão
desta seção):**

- **Não é `UNIQUE(system_code, entity_type, legacy_id)` global.** Essa
  primeira versão entrava em tensão direta com `SUPERSEDED`: se uma
  correção de matching precisa apontar o mesmo registro legado para
  OUTRA `Organization`, preservando a referência antiga como histórico
  (o próprio propósito de `SUPERSEDED`), uma UNIQUE cobrindo todas as
  linhas bloquearia a inserção da linha corrigida enquanto a antiga
  existisse — `SUPERSEDED` ficaria decorativo, nunca utilizável de fato.
- **Também não é só "camada de aplicação" (check-then-insert sem UNIQUE
  nenhuma).** Essa segunda tentativa de correção abria uma janela de
  corrida real (TOCTOU): duas transações concorrentes checando "existe
  ACTIVE?" ao mesmo tempo (nenhuma vê a outra), cada uma inserindo uma
  linha ACTIVE — resultando em duas ACTIVE para a mesma chave lógica,
  exatamente o que a invariante deveria impedir.
- **Solução final: coluna gerada (`VIRTUAL`) + `UNIQUE KEY`
  condicional**, implementada na migration 0013:
  ```
  active_match_key VARCHAR(154) GENERATED ALWAYS AS (
    CASE WHEN status = 'ACTIVE'
         THEN CONCAT(system_code, ':', entity_type, ':', legacy_id)
         ELSE NULL END
  ) VIRTUAL
  UNIQUE KEY uk_org_ext_ref_active_match (active_match_key)
  ```
  MariaDB/InnoDB trata cada `NULL` como distinto dentro de uma
  `UNIQUE KEY` (comportamento padrão SQL) — então linhas `SUPERSEDED`
  (sempre `active_match_key = NULL`) nunca colidem entre si nem com a
  linha `ACTIVE`, mas duas tentativas de `ACTIVE` para a mesma chave
  lógica colidem sempre, **garantido pelo próprio banco, atomicamente,
  sem janela de corrida** — o InnoDB rejeita o segundo INSERT
  concorrente com um erro de chave duplicada real. A checagem otimista
  em `CreateOrganizationExternalReferenceService`
  (`existsActiveBySystemCodeEntityTypeAndLegacyId`) continua existindo,
  mas só como *fast fail* para uma mensagem de erro de domínio amigável
  no caso comum — a garantia real é a `UNIQUE KEY` sobre a coluna
  gerada; se a checagem otimista perder a corrida, o `INSERT` ainda
  falha no banco, e `MariaDbOrganizationExternalReferenceRepository`
  traduz esse erro de volta para o mesmo erro de domínio
  (`OrganizationExternalReferenceAlreadyExistsError`).
- Um índice comum (não único), `idx_org_ext_ref_system_entity_legacy`,
  continua existindo sobre `(system_code, entity_type, legacy_id)` para
  consultas por todo o histórico (ACTIVE + SUPERSEDED).

Quanto a "quantas referências do mesmo sistema uma `Organization` pode
ter": no caso comum é 1 ACTIVE (uma `Organization` ↔ um registro legado
por sistema); múltiplas linhas `SUPERSEDED` para a mesma
`(system_code, entity_type, legacy_id)` são esperadas ao longo do tempo
— cada correção de matching sucessiva adiciona uma nova `SUPERSEDED`
sem jamais apagar as anteriores (rastreabilidade histórica completa,
§9.3).

Isso evita a tentativa (frágil e já comprovadamente falsa) de assumir que
`id=13` no HUB, no Portal e no Helpdesk se referem à mesma empresa. Cada
sistema legado ganha uma linha por `Organization` que ele já conhece,
sem depender de os IDs internos coincidirem.

### 9.2 Sequência de migração (etapas, não datas)

1. **Bootstrap de `Organization` no Ingressa** a partir do HUB
   (`clientes` + `clientes_grupo` + `clientes_grupo_membros`), por ser
   hoje a base com maior cobertura e a que o Helpdesk já trata
   informalmente como fonte — isso formaliza o que já acontece na
   prática, movendo-o para o lugar certo (Ingressa) em vez de preservá-lo
   como acesso direto a banco.
2. Para cada `cliente`/`clientes_grupo` do HUB, criar `Organization` com
   novo `public_id` e registrar uma linha em
   `organization_external_references` (`system_code='PCTEC_HUB'`).
3. **Portal**: para cada `cliente` do Portal, tentar correlacionar por
   `document_number` (CNPJ) com uma `Organization` já criada a partir do
   HUB, usando `document_number` estritamente como **evidência de
   correlação**, nunca como identificador (§9.1-bis). O resultado de cada
   tentativa de matching é classificado, nunca resolvido silenciosamente:
   - `MATCHED` — o CNPJ bate com uma `Organization` existente e os dados
     conferem; cria-se a `OrganizationExternalReference`
     (`system_code='PCTEC_PORTAL'`).
   - `UNMATCHED` — nenhuma `Organization` com esse CNPJ; reportado como
     GAP (cliente existe no Portal mas não no HUB, ou documento não bate).
   - `CONFLICT` — o mesmo CNPJ aparece com dados incompatíveis entre
     sistemas (ex.: razão social muito divergente); reportado, não
     mesclado.

   **Revisão do Product Owner (G2, antes do commit): a quarta
   classificação originalmente prevista aqui, `AMBIGUOUS` ("mais de uma
   Organization candidata para o mesmo CNPJ"), foi removida.** Esta
   seção foi escrita antes de G1 implementar
   `UNIQUE KEY uk_organizations_document_type (document_number, type)`
   em `organizations` (migration 0010) — essa constraint garante, no
   próprio banco, no máximo UMA `Organization` por `(document_number,
   type)`. Com isso, "mais de uma Organization candidata para o mesmo
   CNPJ+type" tornou-se estruturalmente impossível: qualquer consulta
   por `document_number`+`type` retorna no máximo 1 linha, sempre. Se
   isso um dia ocorrer mesmo assim, não é um caso de negócio a
   classificar — é uma violação de invariante (dado corrompido, ou a
   constraint contornada fora da aplicação), tratada como erro rígido
   (`OrganizationDocumentUniquenessInvariantViolatedError`), nunca como
   uma linha reportável do bootstrap. `MATCHED`/`UNMATCHED`/`CONFLICT`
   já são exaustivos para o resultado de uma correlação normal.
4. **Helpdesk**: mesmo processo de correlação e mesma classificação
   MATCHED/UNMATCHED/CONFLICT (o Helpdesk hoje só tem
   `name`/`cnpj` na própria `clients`, e depende do HUB só para grupo) —
   cada `client_id` local que resultar em `MATCHED` ganha sua
   `OrganizationExternalReference` (`system_code='PCTEC_HELPDESK'`).
5. Só depois da correlação e do reporte de GAPs é que se decide, produto
   a produto, quando cada um passa a **consumir** `Organization`/
   `Membership` do Ingressa via API em vez de manter cadastro próprio —
   isso é migração de comportamento, tratada fase a fase, não um
   evento único.
6. O acesso direto do Helpdesk ao banco do HUB é eliminado como parte
   dessa migração do Helpdesk (Fase H, registrada mas não iniciada
   agora). **Não se compromete aqui nenhum formato de endpoint
   específico** — registra-se apenas que o Helpdesk deverá futuramente
   consumir contrato/API oficial do Ingressa; o desenho desse contrato
   nasce quando a Fase H for atacada, não antes.

### 9.1-bis CNPJ não é identificador cross-system

Trava documental explícita: **CNPJ/`document_number` é evidência de
correlação durante a migração; nunca é identificador cross-system.** O
único identificador cross-system, antes e depois da reconciliação, é
`Organization.publicId`. Isso vale mesmo depois de todo o matching
concluído — nenhum sistema deve voltar a usar CNPJ como chave de
integração no lugar do `publicId`.

### 9.3 Correspondência sem perda

Nenhum `id` legado é descartado — `organization_external_references` preserva
a rastreabilidade completa (`system_code` + `legacy_id`) indefinidamente,
mesmo depois que um sistema para de ser dono e passa a só consumir. Isso
permite auditoria retroativa ("esse cliente do Portal correspondia a
qual `cliente_id` do HUB em 2026?") sem depender de os três sistemas
nunca terem usado o mesmo `id`.

## 10. Plano mínimo até o primeiro frontend do Portal

**Revisão do Product Owner:** o plano original tinha 7 etapas
horizontais; substituído por **4 entregas verticais**, cada uma sujeita a
aprovação própria antes da seguinte começar. G1 já está autorizado para
início de implementação (ADR-031); G2–G4 não.

```
G1 — Organization Foundation
G2 — Membership + bootstrap DEV
G3 — PCTEC_PORTAL + PortalContext + OrganizationAccess
G4 — FRONTEND
```

**G1 — Organization Foundation** *(autorizado para código)*
Implementar `Organization` e `OrganizationRelationship` no backend do
Ingressa (migrations + domínio + testes) — desenho já pronto em
`MODELO-RELACIONAL-PROPOSTO.md`, incluindo `document_number` nullable
para `BUSINESS_GROUP` (§2). Sem `Membership` ainda.

**G2 — Membership + bootstrap DEV**
Implementar `Membership` (domínio + testes) e
`OrganizationExternalReference` (§9.1). Rodar o bootstrap de dados reais
a partir do HUB e a correlação MATCHED/UNMATCHED/CONFLICT com
Portal e Helpdesk (§9.2), em DEV, com o mesmo rigor de hermeticidade já
demonstrado na integração da Fase F. GAPs de matching são reportados,
não resolvidos automaticamente.

**G3 — PCTEC_PORTAL + PortalContext + OrganizationAccess**
Criar `Application` `PCTEC_PORTAL` (seed); implementar
`GetPortalContextService` / `GET /api/v1/portal/context` (§7); implementar
`requireOrganizationAccess` (§8, revalidação backend por chamada, nunca
o frontend como autoridade — §6) e aplicá-lo em pelo menos uma rota de
teste real.

**G4 — Frontend**
```
/login → POST /sessions → cookie HttpOnly → GET /me →
GET /portal/context → escolha da empresa → Dashboard →
primeiro dado comercial REAL
```
A partir daí, evolução vertical (mais dados, mais telas), não mais
infraestrutura horizontal. Portal legado continua rodando em paralelo
(`cliente_id` local) até a migração de comportamento (§9.2 passo 5)
estar validada — sem cutover forçado.

## Status

Documento de design que acompanha ADR-031. **Aprovado conceitualmente
pelo Product Owner na rodada 2 de revisão**, com as 7 correções
incorporadas (contexto ativo revalidado pelo backend; `OrganizationExternalReference`
com identidade própria e `UNIQUE(system_code, entity_type, legacy_id)`;
CNPJ como evidência de matching, nunca identificador; `document_number`
nullable para `BUSINESS_GROUP`; `Membership.profile` como relação, não
autorização; endpoint do Helpdesk não comprometido prematuramente;
roadmap G1–G4). **G1 autorizado para código. G2–G4 aguardam aprovação
própria antes de cada entrega.** Sem migration, seed ou código produzido
nesta entrega.

**Atualização (revisão pré-commit de G2):** a invariante de
`OrganizationExternalReference` descrita acima como
`UNIQUE(system_code, entity_type, legacy_id)` foi corrigida — não é mais
uma UNIQUE global (entraria em tensão com `SUPERSEDED`), nem pura
camada de aplicação (janela de corrida real). Solução final: coluna
gerada + `UNIQUE KEY` condicional, sem janela de corrida, detalhada em
§9.1. `AMBIGUOUS` também foi removido da classificação de matching
contra `Organization` canônica (§9.2) — estruturalmente impossível dado
`uk_organizations_document_type` (G1). Decisão de lifecycle de
`Membership` fechada em §4: reativação futura reusa a mesma linha,
nunca cria uma segunda para a mesma `(identity, organization, profile)`.
