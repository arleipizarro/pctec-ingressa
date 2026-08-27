# Vínculo administrativo de organizações ao Portal

Como uma COMPANY passa a ser visível para o PCTEC Portal — e por que o
CLI deixou de ser o caminho cotidiano.

## O que o vínculo é

`OrganizationExternalReference(PCTEC_PORTAL, clientes, legacyId)` resolve
uma COMPANY do Ingressa para uma linha de `pctecdb.clientes`. Sem ela, o
Portal autentica a pessoa, resolve o contexto organizacional e falha em
toda tela comercial: não há como escopar as consultas dele.

Regras estruturais, não convenções:

- **uma COMPANY, um cliente legado.** A invariante de banco é "no máximo
  uma referência ACTIVE por (systemCode, entityType, legacyId)"
  (`uk_org_ext_ref_active_match`, migration 0013);
- **um BUSINESS_GROUP nunca tem referência própria.** A visão consolidada
  é a soma das referências das empresas filhas. Dar ao grupo uma
  referência sua criaria uma segunda fonte de verdade para o mesmo
  número, e as duas divergiriam na primeira entrada ou saída de empresa;
- **`clientes_grupo` nunca é usado** para produzir contexto comercial
  (decisão fechada no piloto AFIP).

## Pela tela

`Organizações → (abrir a empresa) → Integração com o Portal`.

- **COMPANY não vinculada** — botão “Vincular ao Portal”, campo “ID do
  cliente no Portal”, confirmação explícita. O aviso diz o alcance: o
  vínculo vale para **todos** os usuários do Portal daquela empresa e
  **não pode ser trocado nem revogado** por esta tela.
- **COMPANY vinculada** — estado, id do cliente e `publicId` técnico da
  referência. Nenhuma ação de troca, revogação ou exclusão: elas não
  existem no servidor nesta fatia.
- **BUSINESS_GROUP** — cobertura (`vinculadas / total de empresas
  ativas`) e a lista das empresas pendentes, cada uma com link para a
  própria tela. Nunca um campo de id: grupo não tem `clientes.id`.

## O gate do provisionamento

`Novo usuário` com `PCTEC_PORTAL` selecionado exige cobertura:

| organização | exigência | código de recusa |
|---|---|---|
| COMPANY | referência `PCTEC_PORTAL`/`clientes` ACTIVE | `PORTAL_ORGANIZATION_REFERENCE_REQUIRED` |
| BUSINESS_GROUP | todas as empresas ativas vinculadas, e ao menos uma ativa | `PORTAL_GROUP_REFERENCE_INCOMPLETE` |

A recusa acontece **antes da transação de provisionamento**: nenhuma
Identity, Membership, ApplicationAccess ou convite chega a existir. A
tela bloqueia o botão pelo mesmo motivo, mas a autoridade é o servidor —
um POST direto na rota recebe a mesma recusa.

Aplicações que não são o Portal (`PCTEC_HELPDESK`, `PCTEC_INGRESSA`,
qualquer outra) seguem sem exigência nenhuma, e a cobertura sequer é
consultada.

## Códigos de erro do vínculo

| código | HTTP | quando |
|---|---|---|
| `PORTAL_REFERENCE_LEGACY_ID_INVALID` | 422 | `legacyId` não é inteiro positivo |
| `PORTAL_REFERENCE_COMPANY_REQUIRED` | 422 | tentativa em BUSINESS_GROUP |
| `PORTAL_REFERENCE_ORGANIZATION_NOT_ACTIVE` | 422 | organização INACTIVE |
| `PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND` | 404 | organização inexistente |
| `PORTAL_REFERENCE_ALREADY_LINKED_DIFFERENT` | 409 | a empresa já aponta para outro `legacyId` |
| `ORGANIZATION_EXTERNAL_REFERENCE_ALREADY_EXISTS` | 409 | esse `legacyId` já pertence a outra empresa |

Repetir o **mesmo** vínculo responde **200** com `alreadyLinked: true` —
nada é escrito e nenhum evento novo é gravado. Sob concorrência a
autoridade é a UNIQUE KEY: duas requisições idênticas simultâneas podem
resultar em uma 201 e um 409, nunca em sobrescrita.

## O CLI

`bootstrap-organization-external-reference` continua existindo, correto e
inalterado. Ele permanece como ferramenta de exceção — carga inicial,
recuperação, sistemas e entidades que a tela deliberadamente não expõe
(a rota administrativa fixa `PCTEC_PORTAL`/`clientes` e não aceita
outros valores). Para vínculos novos no dia a dia, use a tela.

## O que ainda não existe

Revogar, trocar e excluir um vínculo. O modelo prevê `SUPERSEDED`, mas
nenhum comando de domínio faz essa transição hoje; implementá-la junto
com a tela significaria inventar a regra de sucessão no mesmo movimento.
Enquanto isso, um vínculo errado é corrigido pelo CLI, com registro.

## Próxima etapa — correspondência automática por CNPJ

Planejada, **não implementada** nesta fatia. O desenho acordado:

1. importar o CNPJ do Helpdesk para `organizations.document_number`,
   normalizado (só dígitos);
2. criar um catálogo/contrato de leitura seguro para a correspondência
   com os clientes do Portal — sem expor documento em resposta de
   produto;
3. vincular automaticamente **somente** por CNPJ normalizado, **único** e
   **exato**, dos dois lados;
4. ausente, duplicado ou ambíguo fica em revisão manual, na mesma tela
   deste PR;
5. **nunca** vincular por semelhança de nome. Razão social e nome
   fantasia divergem entre sistemas, se repetem entre filiais e mudam
   sem aviso — um "match" por nome erra em silêncio e o erro só aparece
   quando alguém lê o faturamento da empresa errada.
