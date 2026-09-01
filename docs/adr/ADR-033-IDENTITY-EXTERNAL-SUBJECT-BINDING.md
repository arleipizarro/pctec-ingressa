# ADR-033 — `IdentityExternalReference` é contrato explícito de binding Identity ↔ sujeito em sistema externo

## Contexto

Até esta decisão, `identity_external_references` (migration 0016) era
descrita, na própria migration, como rastreabilidade e nada mais. O
comentário de `legacy_id` dizia, textualmente:

> `legacy_id`: BIGINT, id local do sistema legado (portal_acesso.id, por
> exemplo). **NUNCA um contrato cross-system** — só rastreabilidade.

Aquela redação fazia sentido no problema que a 0016 resolvia. O Portal
tinha `portal_acesso.id` e precisava descobrir qual `Identity.publicId`
correspondia; a tabela existia para responder *essa* pergunta, numa
direção só, e o `legacy_id` era de fato apenas a entrada da consulta.

O PCTEC Meu RH inverte a pergunta. Ali a pessoa já está autenticada — o
Ingressa sabe quem ela é — e o que falta descobrir é **qual colaborador
do HUB ela é**, para que o produto possa buscar holerite, férias e
contracheque na fonte certa. A resposta a essa pergunta não é
rastreabilidade: é a decisão que determina de quem são os dados exibidos
na tela. Se estiver errada, uma pessoa vê o holerite de outra.

Uma referência persistida que decide isso **é** um contrato
cross-system, chamem-na do que quiserem. Esta ADR reconhece isso e
assume as obrigações que vêm junto — em vez de deixar a promessa
implícita num comentário que dizia o contrário.

## Decisão

### 1. Os três eixos, e o que cada um responde

```
Identity
   │
   ├── ApplicationAccess     → PODE ENTRAR nesta Application?
   │
   ├── Membership            → relação com uma Organization
   │                           (NUNCA vínculo trabalhista)
   │
   └── IdentityExternalReference
                             → QUEM ela representa fora do Ingressa
```

Os três são independentes. Ter acesso a uma aplicação não implica
binding nenhum; ter binding não concede acesso a nada; e Membership não
diz nada sobre emprego.

### 2. `ApplicationAccess` + `IdentityExternalReference` como binding do Meu RH

```
Identity.publicId
      │
      ▼
identity_external_references
  system_code = PCTEC_HUB
  entity_type = rh_colaboradores
  status      = ACTIVE
      │
      ▼
  legacy_id
      │
      ▼
HUB rh_colaboradores.id
```

`ApplicationAccess` decide se a Identity pode entrar no
`PCTEC_MEU_RH`. `IdentityExternalReference` decide qual registro de
`rh_colaboradores` ela é. **Nenhuma tabela de binding é criada no Meu
RH** — ver §6.

### 3. Por que e-mail não serve como chave

Já existe caso confirmado em produção: a Identity
`arlei.pizarro@pctec.com.br` e o `portal_acesso.id = 33`
(`arlei@pizarros.com.br`) são a **mesma pessoa** com e-mails diferentes.
Não é anomalia — é o normal em qualquer parque com sistemas de épocas
diferentes.

Além disso, e-mail **muda**: casamento, troca de domínio, correção de
grafia, migração de provedor. Uma chave que muda não é chave; é um
apelido. Se o binding fosse por e-mail, a primeira troca de e-mail
apontaria a pessoa para o registro errado — ou para nenhum — sem que
ninguém percebesse, porque nada teria sido "quebrado" no sentido usual.

### 4. Por que CPF não será usado em runtime

CPF **identifica** uma pessoa; e é justamente por isso que não pode
circular como chave de integração. Usá-lo em runtime significaria
transportá-lo em URL, log de acesso, cache de proxy, payload de evento e
métrica — multiplicando as cópias de um dado pessoal sensível por
motivo nenhum, já que o Ingressa tem um identificador próprio, estável e
opaco (`Identity.publicId`, ADR-021) que serve melhor.

CPF pode participar, uma única vez, de uma **cerimônia de onboarding**
supervisionada — o momento de decidir que a Identity X corresponde ao
colaborador Y. O resultado dessa decisão é gravado como
`IdentityExternalReference`, e a partir daí é a referência que responde.
Nunca o CPF, nunca em runtime.

### 5. Por que a referência passa a ser contrato, e o que isso obriga

Reconhecer o contrato não é mudar uma palavra no comentário. Ele obriga:

| Obrigação | Como esta entrega cumpre |
|---|---|
| Unicidade garantida | UNIQUE KEY `uk_id_ext_ref_active_binding` (migration 0024) |
| Correção sem SQL manual | `SupersedeIdentityExternalReferenceService` + CLI |
| Histórico preservado | `SUPERSEDED` nunca é exclusão; não há `DELETE` em lugar nenhum |
| Leitura auditável | eventos `.created` e `.superseded`, com ator e correlação |
| Fronteira controlada | rota service-to-service com credencial própria, nunca browser-facing |

`legacy_id` continua **não sendo** identificador de Identity: ele não
identifica ninguém fora do sistema que o emitiu, e nunca substitui
`Identity.publicId` como identificador cross-system do Ingressa. O que
mudou é que a LINHA que associa os dois é um contrato estável, e não uma
anotação.

### 6. Por que não criaremos tabela duplicada no Meu RH

Uma tabela `meurh_identity_binding` pareceria conveniente e seria uma
segunda fonte de verdade sobre a mesma pergunta. Duas fontes de verdade
sobre "quem esta pessoa é" divergem — não *se*, mas *quando*: um
supersede feito no Ingressa não chegaria à cópia, e o Meu RH continuaria
apontando para o colaborador antigo com toda a confiança do mundo. O
sintoma seria dado trabalhista de outra pessoa na tela, e a causa estaria
a dois sistemas de distância.

O Meu RH resolve o binding **em tempo de requisição**, pela fronteira
service-to-service, e não guarda o resultado como verdade própria. Cache
de curta duração é decisão de implementação do consumidor; cópia
persistente com ciclo de vida próprio, não.

### 7. Responsabilidades

**Do Ingressa:**

- ser a fonte da Identity e do binding;
- garantir, no banco, no máximo um binding ACTIVE por
  `(identity_public_id, system_code, entity_type)`;
- oferecer as duas direções de resolução;
- oferecer lifecycle de correção auditado, sem SQL manual;
- nunca devolver referência `SUPERSEDED` como se fosse vigente;
- recusar, em vez de escolher, quando o binding estiver ambíguo.

**Do sistema de origem (HUB, Helpdesk, Portal):**

- ser dono do registro que o `legacy_id` aponta e do significado dele;
- avisar quando o registro for substituído ou deixar de existir — o
  Ingressa não vigia bancos alheios e não tem como descobrir sozinho;
- nunca reaproveitar um `legacy_id` para outra pessoa. Se isso
  acontecer, nenhuma garantia deste ADR sobrevive, porque a premissa
  ("o registro N é sempre a mesma pessoa") deixou de valer.

**Do produto consumidor:**

- resolver o binding a cada requisição, pela fronteira de serviço;
- tratar `404` como "sem vínculo" e `409` como "vínculo ambíguo,
  recusar" — nunca como "provavelmente é este";
- nunca receber `identityPublicId` do navegador como autoridade.

### 8. Lifecycle

```
        create                     markSuperseded
  (nasce ACTIVE)  ────────────────────────────────►  SUPERSEDED
                                                     (terminal)
```

Transição única e de mão única. **Não existe reativar**: um binding que
voltasse a valer é uma decisão nova, e decisão nova é referência nova —
com sua própria data, seu próprio ator e seu próprio evento. Reaproveitar
a linha antiga apagaria exatamente o que a auditoria precisa saber.

**`SUPERSEDED` ≠ exclusão.** A linha permanece inteira e continua
consultável; o que ela deixa de ser é a resposta ACTIVE. Apagar
destruiria a evidência de como o vínculo errado surgiu — que é
precisamente o que se quer conservar quando o erro expôs dado de outra
pessoa. Não há `DELETE` sobre `identity_external_references` em nenhum
ponto do código.

Substituição é **uma transação**: supersede da antiga e insert da nova,
nessa ordem. A ordem importa: como a coluna gerada
`active_binding_flag` fica `NULL` na linha superada, a chave única é
liberada antes do insert, e em nenhum instante — nem dentro da
transação — existem duas linhas ACTIVE. Se o insert falhar, o supersede
é desfeito junto: nunca se fica sem vínculo por causa de uma
substituição malsucedida.

### 9. Invariantes

1. **No máximo 1 ACTIVE por `(identity_public_id, system_code,
   entity_type)`** — `uk_id_ext_ref_active_binding` (0024). A invariante
   é genérica, e não restrita a `PCTEC_HUB`: "uma pessoa representa no
   máximo um sujeito por sistema/entidade" é verdade semântica da
   entidade inteira. Uma pessoa não é dois usuários do Helpdesk, nem
   dois `portal_acesso`.
2. **No máximo 1 ACTIVE por `(system_code, entity_type, legacy_id)`** —
   `uk_id_ext_ref_active_match` (0016), a invariante simétrica: um
   registro do sistema de origem nunca é reivindicado por duas
   Identities.
3. Linhas `SUPERSEDED` não participam de nenhuma das duas e coexistem
   livremente como histórico.
4. Referência `SUPERSEDED` nunca é devolvida como vigente.
5. Ambiguidade (estado que 1 torna impossível de criar, mas que uma
   restauração parcial de backup poderia produzir) é **recusa**, nunca
   escolha.

#### Optimistic locking: por que sem coluna `version`

As entidades que mutam de várias formas (`Identity`,
`ApplicationAccess`, `Membership`) carregam `version` porque duas
escritas concorrentes podem ser sobre coisas diferentes, e sobrescrever
cegamente apagaria uma delas. `IdentityExternalReference` tem UMA
transição, de mão única, sem outro campo mutável: aqui **o estado é a
versão**. O `UPDATE` é condicionado a `status = 'ACTIVE'`
(compare-and-swap), e zero linhas afetadas significa exatamente o que
`WHERE version = ?` significaria — alguém chegou primeiro. Uma coluna
`version` daria a mesma garantia com mais schema, mais mapeamento e mais
um número para manter sincronizado.

### 10. Auditoria

| Evento | Quando | Payload |
|---|---|---|
| `identity-external-reference.created` | binding nasce | publicIds, `systemCode`, `entityType`, `matchMethod` |
| `identity-external-reference.superseded` | binding deixa de valer | publicIds, `systemCode`, `entityType`, `reason`, `replacedByPublicId?` |

Ambos preservam `correlationId`, `causationId`, `actorPublicId` e
`eventVersion`, conforme o padrão desta base. Numa substituição, os dois
eventos compartilham o `correlationId` (é uma operação só) e o
`.created` da substituta carrega `causationId` apontando para o
`.superseded` — a cadeia fica navegável nos dois sentidos, sem inferir
nada por horário de gravação.

`reason` é **enum fechado** (`MATCH_CORRECTION`,
`SOURCE_RECORD_REPLACED`, `IDENTITY_OFFBOARDED`), nunca texto livre.
Texto livre digitado por quem opera acabaria carregando nome, CPF ou
"conversa" para dentro de um registro append-only, de onde não se apaga
— e a auditoria nunca precisou disso: o que ela pergunta é que CLASSE de
evento causou a troca.

Nenhum evento carrega `legacy_id`, e-mail, nome ou CPF.

### 11. Fronteira de leitura

```
GET /api/v1/service/identity-external-references/:systemCode/:entityType/identities/:identityPublicId
```

Genérica de propósito: `systemCode` e `entityType` são parâmetros, e
nenhum produto consumidor aparece na URI. O Ingressa é a fonte da
identidade e do binding; conhecer o consumidor pelo nome faria dele parte
do contrato, e cada produto novo exigiria uma rota nova.

Protegida por `requireServiceCredential` com **credencial e header
próprios** (`x-identity-resolution-service-credential`), separados dos do
Portal e do Helpdesk — vazar uma não pode dar acesso às outras, e revogar
uma não pode derrubar as outras. Sem a variável configurada, o namespace
responde `401` a tudo. Nunca browser-facing.

Respostas: `200` (exatamente um binding), `404` (sem vínculo), `409`
(ambíguo), `422` (parâmetro inválido), `401` (sem credencial).
**Identity inexistente responde o mesmo `404` de Identity sem vínculo**,
de propósito: distinguir os dois entregaria, a quem tivesse a
credencial, um oráculo de existência de identidades.

### 12. O que o Membership NÃO é

```
Membership → relação com uma Organization
             NUNCA vínculo trabalhista
```

Membership não ganha salário, matrícula, cargo, departamento, contrato,
data de admissão nem qualquer regra trabalhista. O vínculo de trabalho
pertence ao domínio de RH:

```
Meu RH   → dados trabalhistas (apresentação e regras do produto)
HUB      → FONTE dos dados de RH
Ingressa → fonte da identidade e do binding cross-system
```

Se o Membership virasse "onde mora o vínculo trabalhista", o Ingressa
passaria a ser um segundo sistema de RH — com regras de folha, de
admissão e de desligamento — e a fronteira entre identidade e RH, que é
o que mantém os dois sistemas evoluindo sem se atrapalhar, deixaria de
existir.

## Consequências

- O comentário da migration 0016 sobre `legacy_id` ("nunca um contrato
  cross-system") permanece **como está**, e este ADR o supera
  explicitamente. Migration aplicada não se reescreve; a decisão nova
  vive aqui.
- Criar uma `IdentityExternalReference` passa a poder falhar com
  `IDENTITY_EXTERNAL_REFERENCE_BINDING_ALREADY_EXISTS` (409) — situação
  antes possível e silenciosa.
- Corrigir binding deixa de ser operação de banco e passa a ser comando
  de domínio, com ator, motivo e evento.
- Um consumidor que receba `409` precisa tratar recusa. É deliberado:
  num binding que decide de quem é o holerite, "provavelmente esta" não
  é resposta aceitável.
- Reverter a 0024 é seguro (só índice e coluna derivada), mas devolve a
  invariante à checagem otimista da aplicação — que, sob concorrência,
  não é garantia.

## Status

Aceito na fundação do PCTEC Meu RH. Registro da Application
`PCTEC_MEU_RH` e onboarding de colaboradores **não** fazem parte desta
decisão e permanecem pendentes de cerimônia própria, com dry-run
obrigatório.

Relacionadas: ADR-021 (identificadores), ADR-024 (optimistic locking por
`version` — cuja exceção justificada está em §9), ADR-028
(`ApplicationAccess`), ADR-031 (Organization canônica), ADR-035
(política de emissão SSO por aplicação).
