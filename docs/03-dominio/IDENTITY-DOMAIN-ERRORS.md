# Identity Domain Errors — PCTEC Ingressa

Versão associada: v0.3.0 — Identity Core (documental)
Status: Proposto para revisão do Product Owner e do Platform Architect

Catálogo de códigos de erro de domínio do bounded context `identity`. Os
códigos são estáveis e destinados a tratamento programático; o mapeamento
para HTTP é apenas conceitual, pois nenhuma API funcional é criada nesta
fase (ver `API-CONTRACT-V1.md` para o formato de erro padronizado já
definido em v0.2.0, ao qual estes códigos se conectam futuramente).

## Convenção de classificação

- **Validação:** dado de entrada inválido ou ausente, identificável antes
  de qualquer consulta de estado.
- **Conflito:** o dado é sintaticamente válido, mas colide com uma
  invariante de estado atual (unicidade, transição, versão).
- **Autorização:** a operação é recusada por ausência de informação de
  responsabilidade (actor), não por permissão fina (que não pertence a
  este domínio).

| Código | Condição | Significado | Classificação | HTTP conceitual |
|---|---|---|---|---|
| `IDENTITY_NOT_FOUND` | `public_id` informado não corresponde a nenhuma `Identity` existente | A identidade referenciada não existe | Validação | 404 |
| `IDENTITY_EMAIL_REQUIRED` | `email` ausente ou vazio em `CreateIdentity` | E-mail é obrigatório | Validação | 422 |
| `IDENTITY_EMAIL_INVALID` | `email` presente mas sintaticamente inválido | Formato de e-mail inválido | Validação | 422 |
| `IDENTITY_EMAIL_ALREADY_EXISTS` | `email_normalized` já pertence a outra identidade | Violação de unicidade de e-mail | Conflito | 409 |
| `IDENTITY_CPF_INVALID` | `cpf` informado mas com formato inválido | CPF informado é inválido | Validação | 422 |
| `IDENTITY_CPF_ALREADY_EXISTS` | `cpf_normalized` já pertence a outra identidade | Violação de unicidade de CPF | Conflito | 409 |
| `IDENTITY_TYPE_NOT_SUPPORTED` | `type` diferente de `HUMAN` em operação de criação no MVP | Tipo de identidade não implementado nesta fase | Validação | 422 |
| `IDENTITY_STATUS_TRANSITION_INVALID` | Comando de transição de estado não permitido a partir do `status` atual | Transição fora da máquina de estados definida | Conflito | 409 |
| `IDENTITY_LOGIN_DISABLED` | Tentativa de autenticação com `login_enabled = false` | Login desabilitado para esta identidade | Autorização | 403 |
| `IDENTITY_BLOCKED` | Tentativa de autenticação (ou operação incompatível) com `status = BLOCKED` | Identidade bloqueada | Autorização | 403 |
| `IDENTITY_INACTIVE` | Tentativa de autenticação (ou operação incompatível) com `status = INACTIVE` | Identidade inativa | Autorização | 403 |
| `IDENTITY_DELETED` | Operação tentada sobre identidade com `status = DELETED` | Identidade excluída logicamente; operação não permitida | Conflito | 409 |
| `IDENTITY_VERSION_CONFLICT` | `version` informada diverge da `version` atual da identidade | Conflito de concorrência otimista (ADR-024) | Conflito | 409 |
| `ACTOR_REQUIRED` | Comando executado sem `actor` identificado | Todo comando relevante exige actor para auditoria | Validação | 422 |
| `DELETION_REASON_REQUIRED` | `LogicallyDeleteIdentity` sem `deletion_reason` | Motivo de exclusão é obrigatório | Validação | 422 |

**Nota de correção (ADR-025):** os códigos `IDENTITY_PROFILE_ALREADY_EXISTS`
e `IDENTITY_PROFILE_NOT_FOUND`, presentes em versão anterior deste
catálogo, foram removidos — não pertencem ao domínio `identity`. A
classificação relacional que motivava esses erros pertence ao `Membership`
(bounded context `organization`/`access`); códigos equivalentes, se
necessários, serão definidos naquele contexto.

## Observações

- Nenhum destes erros carrega, em sua mensagem ou em `details`, dados
  pessoais de terceiros — apenas o dado sintaticamente inválido do próprio
  request, quando aplicável (ex.: o e-mail informado que falhou a
  validação de formato pode ser ecoado, pois é o próprio dado de entrada
  do solicitante; o CPF de outra identidade que já existe **não** é
  ecoado).
- O mapeamento para HTTP é conceitual e ilustrativo, alinhado ao formato de
  erro já definido em `API-CONTRACT-V1.md`; não constitui contrato de API
  funcional, pois nenhuma API é implementada nesta fase.
- Novos erros podem ser adicionados por bounded contexts vizinhos
  (`security`, `organization`, `access`) sem alterar este catálogo — este
  documento cobre exclusivamente erros originados no bounded context
  `identity`.
