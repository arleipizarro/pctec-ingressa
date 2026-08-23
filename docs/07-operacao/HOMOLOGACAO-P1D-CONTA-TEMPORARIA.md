# Homologação P1D — conta temporária de acesso ao Portal

**Status: ativo durante a homologação de P1D (v0.7.x). Esta conta NÃO
pode se tornar o cadastro produtivo definitivo da AFIP.**

## O que foi decidido

`portal_acesso.id = 33` (`arlei@pizarros.com.br`) é uma conta
**temporária de homologação**. Durante a P1D ela deve enxergar
exclusivamente:

| Organization | Tipo | `publicId` |
|---|---|---|
| AFIP | `BUSINESS_GROUP` | `cc9c41b2-425b-48f2-82d9-506d396c2562` |
| AFIP - BÉLGICA | `COMPANY` | `e99baabc-a86a-404e-982c-59b744627aba` |
| AFIP - BOSQUE | `COMPANY` | `971ec096-e7de-4cc1-be06-2b4709565757` |
| AFIP - CLEMENTINO | `COMPANY` | `3abb40e7-1e3e-44fa-9a14-44569e373fbc` |
| AFIP - SANTANA | `COMPANY` | `d86ed78a-5b54-48a8-94fe-b432d14078ed` |

E **não** deve acessar nem visualizar a Organization `PCTEC`
(`b5c4358b-c8aa-42a8-9589-7c09c015f5fb`).

## O que foi feito

O `Membership` que ligava a Identity
`66231e51-66fb-466d-af4f-ac7b925ca9ec` à Organization `PCTEC`
(`57559d06-9c26-4a36-911e-bc686fc4dc4b`, `profile=CUSTOMER`,
`scope=ORGANIZATION_ONLY`) foi **encerrado** — `ACTIVE → INACTIVE`, com
`ended_at` preenchido — pela CLI oficial `end-portal-membership`.

O `Membership` no grupo AFIP
(`0e656db2-9084-4e0e-a3a5-870a9bf034e6`, `profile=CUSTOMER`,
`scope=ORGANIZATION_AND_DESCENDANTS`) já existia e permanece `ACTIVE`:
é ele que produz as cinco Organizations acima no `PortalContext`.

**Encerrar não apagou nada.** A linha do Membership continua no banco,
consultável, com o histórico da transição em `audit_events`
(`membership.updated`) — nenhum dado foi perdido. Reverter, porém, não é
automático hoje: ver "Como reverter", abaixo.

### O que deliberadamente NÃO foi tocado

- `ApplicationAccess` — a Identity mantém `PCTEC_PORTAL/USER` e
  `PCTEC_INGRESSA/ADMIN`, ambos `GRANTED`. Acesso à aplicação e alcance
  organizacional são eixos independentes (ADR-031 §6); restringir o
  escopo comercial nunca deve revogar o acesso ao sistema.
- A Organization `PCTEC` — segue `ACTIVE`, `version=1`, intocada. O que
  saiu foi o vínculo, não a empresa.
- `OrganizationRelationship`, `OrganizationExternalReference` e qualquer
  dado comercial do Portal legado.
- Nenhuma outra Identity.
- O cadastro legado do Portal (`portal_acesso`, `clientes`).

## Divergência conhecida e tolerada

`portal_acesso.id=33` tem `cliente_id = 13` (**TUV RHEINLAND DUCTOR
LTDA**) no cadastro legado do Portal. Esse claim **não** é usado por
nenhuma rota comercial: o escopo vem exclusivamente do Ingressa
(`req.ingressaContext.clienteIds`), e há guarda de teste global
impedindo que `req.user.cliente_id` volte a ser lido pelas rotas
`/api/ingressa/*`.

A divergência é tolerada **apenas para esta homologação**. O cadastro
legado não foi alterado — corrigi-lo exigiria mexer em dados de
produção do Portal sem necessidade para o que está sendo homologado.

## Pendência — esta conta não serve como cadastro produtivo

Antes de a AFIP entrar em produção, é preciso:

1. **Criar as contas reais dos usuários da AFIP** no Portal, cada uma
   com o próprio `portal_acesso` e o próprio
   `IdentityExternalReference` (`PCTEC_PORTAL/portal_acesso/<id>`).
   A conta 33 é de um operador da PCTEC, não de um usuário da AFIP —
   mantê-la como acesso produtivo do cliente confundiria auditoria e
   responsabilidade.
2. **Resolver a divergência `cliente_id = 13`** na conta 33: ou
   corrigindo o cadastro legado, ou encerrando a conta quando a
   homologação terminar. Enquanto ela existir com esse claim, qualquer
   rota legada futura que volte a lê-lo apontaria para a TUV.
3. **Decidir o vínculo comercial da Organization `PCTEC`** — ela
   continua sem `OrganizationExternalReference` para
   `PCTEC_PORTAL/clientes`, então selecioná-la responderia 404 mesmo com
   Membership ativo. Candidatos em `pctecdb.clientes`: `id=79`
   (`PCTEC OUTSOURCING LTDA`, CNPJ 63.799.262/0001-20) e `id=81`
   (`PCTEC Tecnologia`, CNPJ placeholder `00.000.000/0001-00`). O
   vínculo **não foi criado** — a Organization não tem `document_number`
   cadastrado, então não há matching automático defensável; é decisão
   de negócio.

## Como reverter — GAP CONHECIDO: não há caminho automático hoje

**Reverter esta revogação não é possível pelas CLIs atuais.** Verificado
no código, não presumido:

- `bootstrap-portal-membership` chamaria
  `CreateMembershipService`, que checa
  `existsByIdentityOrganizationAndProfile` — e essa checagem **não
  filtra por status**. A linha encerrada continua existindo, então a
  recriação falharia com `MEMBERSHIP_ALREADY_EXISTS` (409).
- `Membership.reactivate()` **não existe**. A decisão de lifecycle
  fechada em G2 é que encerrar e reativar operam sempre na MESMA linha
  (é o que torna `uk_membership_unique`, não condicionada a status,
  correta) — mas só `end()` foi implementado, em P1D.1, porque só ele
  tinha caso de uso concreto.

O comportamento é seguro: a tentativa falha com erro explícito, nunca
cria uma linha duplicada nem reativa em silêncio. Mas é uma via de mão
única até que `reactivate()` exista.

**Se a decisão de negócio mudar e a conta 33 precisar voltar a acessar
PCTEC**, o caminho é implementar `Membership.reactivate()` + o
application service e a CLI correspondentes — o mesmo desenho de
`end()`, na mesma linha, emitindo `membership.updated` com a transição
inversa. É trabalho pequeno e já modelado; o que faltava era o caso de
uso, e esta seção passa a ser esse registro.

Enquanto isso não existir, **nenhuma intervenção manual no banco deve
ser feita para reverter** — um `UPDATE` direto pularia a trilha de
auditoria e o controle de versão, exatamente o que a P1D.1 existiu para
evitar.
