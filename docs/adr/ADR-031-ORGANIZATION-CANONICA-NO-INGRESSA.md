# ADR-031 — Organization é domínio canônico do PCTEC Ingressa, não uma réplica

## Contexto

A Fase G partiu da pergunta "quem é dono de Cliente/Grupo?", tratada
inicialmente como decisão em aberto. A auditoria read-only de
`pctec-ingressa`, `pctcontrol` (HUB), `helpcontrol` (Helpdesk) e
`pctportal` (Portal) mostrou que:

- Existem hoje **três tabelas de cliente independentes** (`clientes` no
  HUB, `clientes` no Portal, `clients` no Helpdesk), cada uma com seu
  próprio espaço de `id` `INT AUTO_INCREMENT`, sem nenhuma correspondência
  garantida entre elas. A importação do Helpdesk mapeou clientes por nome
  da empresa, manualmente.
- Nenhum dos três sistemas possui `public_id`/UUID. Toda referência
  cross-sistema hoje é feita por PK interno, o antipadrão que ADR-021 já
  proíbe dentro do próprio Ingressa.
- O Helpdesk acessa o banco do HUB **diretamente** (`pctecdb.clientes_grupo`,
  `pctecdb.clientes_grupo_membros`) via `client_group_id`, sem FK (MariaDB
  não suporta cross-database) e sem API — violação ativa da regra de ouro
  registrada em `GOVERNANCA.md`: *"Nenhum produto deve consultar ou
  alterar diretamente o banco de outro produto."*
- `ADR-005` já havia decidido, documentalmente, que o Cadastro Mestre de
  organizações pertence ao Ingressa — mas nada disso chegou a ser
  implementado; na prática, quem exerce esse papel hoje é o HUB, por
  acidente de integração, não por desenho.

Diante disso, tratar o problema como "para onde copiar os dados de
Cliente/Grupo" cristalizaria a fragmentação existente dentro do próprio
Ingressa, em vez de resolvê-la. O objetivo desta ADR é fechar a decisão
de propriedade e a arquitetura-alvo antes de qualquer migração de dados.

## Decisão

1. **`Organization` é o domínio canônico de empresa/grupo empresarial do
   ecossistema PCTEC**, hospedado no Ingressa. Não é uma cópia dos
   cadastros de HUB/Portal/Helpdesk — é a fonte única de verdade a partir
   da promoção. HUB, Portal e Helpdesk deixam progressivamente de ser
   donos desses identificadores e passam a referenciar `Organization`
   pelo `public_id` canônico.
2. `Organization` possui `type`: `BUSINESS_GROUP` ou `COMPANY`, conforme já
   desenhado em `MODELO-DE-DOMINIO.md` (seção 3) e `MODELO-RELACIONAL-PROPOSTO.md`
   (seção 3). Nenhuma mudança de forma nesta ADR — a decisão nova é de
   *propriedade*, não de estrutura.
3. Hierarquia grupo → empresas continua via `OrganizationRelationship`:
   `parent_organization` (`BUSINESS_GROUP`) → `child_organization`
   (`COMPANY`), sem ciclos, no MVP uma `COMPANY` pertence a no máximo um
   `BUSINESS_GROUP` (já coberto por ADR-004 e pela unique key
   `uk_org_rel_child`).
4. `Membership` representa o vínculo `Identity` ↔ `Organization`, com
   `profile` (`EMPLOYEE`, `CUSTOMER`, `PARTNER`, `SUPPLIER`,
   `SERVICE_ACCOUNT` — já em ADR-025) e `scope`
   (`ORGANIZATION_ONLY` | `ORGANIZATION_AND_DESCENDANTS`). Uma `Identity`
   pode ter **múltiplos `Membership`s ativos simultaneamente** — cobre
   consultor multi-cliente, usuário com vínculo em mais de uma empresa, e
   colaborador PCTEC que também é `CUSTOMER` de outro contexto.
5. `public_id` (`CHAR(36)`, convenção ADR-021) é **identificador
   cross-system obrigatório** para `Organization` e `Membership` a partir
   desta entrega. Nenhum sistema externo deve voltar a usar `id BIGINT`
   interno como contrato entre sistemas.
6. **`ApplicationAccess` autoriza o produto; `Membership` autoriza o
   escopo comercial — são independentes.** ADMIN do Ingressa (via
   `ApplicationAccess` em `PCTEC_INGRESSA`) **não concede acesso
   automático a nenhuma `Organization`**. Um administrador do Portal
   precisa, adicionalmente, de um `Membership` explícito com o escopo
   correspondente para ver dados de um cliente específico. Essa separação
   é a base de segurança do isolamento multi-tenant do Portal (ver
   `PORTAL-CONTEXT-DESIGN.md`).
7. Três categorias de identidade quanto a `Organization`, sem introduzir
   um `type` novo em `Identity` (que permanece `HUMAN`, ADR-018):
   - **Usuário externo**: possui um ou mais `Membership`s com `profile`
     comercial (`CUSTOMER`, `PARTNER`, `SUPPLIER`). É o que acessa o
     Portal.
   - **Colaborador PCTEC**: possui `Membership` com `profile=EMPLOYEE` em
     uma `Organization` interna da PCTEC (a própria PCTEC é modelada
     como `Organization` do tipo `COMPANY`, sem `OrganizationRelationship`
     de grupo).
   - **ADMIN do Ingressa**: é uma questão de `ApplicationAccess`
     (`PCTEC_INGRESSA`, `ADMIN`), ortogonal a `Membership`. Pode ou não
     coincidir com um colaborador PCTEC, mas o acesso administrativo ao
     Ingressa não implica nenhum `Membership` comercial.
8. O acesso direto do Helpdesk ao banco do HUB
   (`pctecdb.clientes_grupo`/`clientes_grupo_membros`) é registrado como
   **dívida arquitetural ativa** — não é preservado nem usado como
   inspiração de integração. Uma frente futura e específica
   (`Fase H — Eliminação do acesso cross-database Helpdesk→HUB`)
   substituirá esse acesso por consumo do Ingressa via API/contrato
   oficial. Esta ADR não bloqueia nem depende dessa frente.

## Consequências

- `docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md` e
  `docs/02-arquitetura/API-CONTRACT-V1.md` precisam de uma nota
  explicando que `organizations`/`memberships` deixam de ser "proposta
  v0.2.0" e passam a estar na fila de implementação real, com
  `public_id` como contrato, não `identity_profile_id` (que já está
  obsoleto por ADR-025 e ainda aparece por engano no exemplo de payload
  de `/api/v1/memberships` em `API-CONTRACT-V1.md` — GAP documental a
  corrigir na próxima revisão desse arquivo).
- Cria-se a necessidade de uma tabela de mapeamento de legado,
  `organization_external_refs`, detalhada em `ORGANIZATION-MEMBERSHIP-DESIGN.md`,
  para correlacionar os `id`s de HUB/Portal/Helpdesk ao `public_id`
  canônico durante a transição, sem forçar equivalência entre os `id=N`
  de bancos diferentes.
- Nenhuma migration, seed ou código é criado nesta entrega. Esta ADR e o
  documento de design que a acompanha fecham a arquitetura para revisão
  do Product Owner antes de qualquer implementação.

## Revisão do Product Owner (rodada 2)

Aprovada conceitualmente, com 7 correções obrigatórias antes de
autorização para código — incorporadas nesta revisão e detalhadas em
`ORGANIZATION-MEMBERSHIP-DESIGN.md`:

1. Contexto ativo selecionado pelo frontend **nunca é autoridade** — cada
   `organizationPublicId` é revalidado pelo backend contra `Membership`
   em toda chamada, sem exceção (endurece o item 6/§8 já existente; não
   é mudança de decisão, é remoção de qualquer ambiguidade sobre "estado
   de frontend" ser suficiente).
2. `OrganizationExternalReference` (renomeada de
   `organization_external_refs`) precisa de identidade própria, `status`
   e timestamps, com `UNIQUE(system_code, entity_type, legacy_id)` como
   invariante — não é só uma tabela de apoio, é a ponte de rastreabilidade
   da migração inteira.
3. CNPJ/`document_number` é **evidência de correlação durante a
   migração**, nunca identificador cross-system. O único identificador
   cross-system, antes e depois da reconciliação, é `Organization.publicId`.
   Matching produz `MATCHED`/`UNMATCHED`/`AMBIGUOUS`/`CONFLICT` — nunca
   cria ou mescla `Organization` silenciosamente em caso duvidoso.
4. `BUSINESS_GROUP.document_number` pode ser `NULL` (grupos comerciais
   frequentemente não têm CNPJ próprio); a unicidade de `document_number`
   por `type` aplica-se só a valores não nulos; um `BUSINESS_GROUP` nunca
   herda artificialmente o CNPJ de uma `COMPANY` filha.
5. `Membership.profile` descreve **a relação** entre `Identity` e
   `Organization` ("com qual organização, e com que alcance") — não
   descreve **autorização funcional** ("o que essa Identity pode fazer").
   `CUSTOMER`/`EMPLOYEE`/`PARTNER`/`SUPPLIER` nunca devem ser interpretados
   como permissão implícita; isso continua sendo responsabilidade da
   camada de autorização, fora de `Membership`.
6. Retirado o compromisso prematuro com um endpoint específico
   (`GET /api/v1/organizations`) para o Helpdesk. Registra-se apenas:
   *Helpdesk deverá futuramente consumir contrato/API oficial do
   Ingressa* — o formato nasce quando a migração do Helpdesk (Fase H)
   for atacada, não antes.
7. O roadmap técnico da Fase G é substituído por 4 entregas verticais
   (ver `ORGANIZATION-MEMBERSHIP-DESIGN.md` §10), terminando em frontend
   real no G4, em vez das 7 etapas horizontais anteriores.

## Status

Aprovada conceitualmente pelo Product Owner / Chief Architect (Arlei
Pizarro), com as 7 correções acima incorporadas. **G1 (Organization
Foundation) autorizado para início de implementação após esta revisão.**
G2–G4 permanecem sujeitos a aprovação própria antes de cada entrega.
