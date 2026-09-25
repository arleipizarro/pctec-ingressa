# Contrato Ingressa ↔ PCTEC Central de Serviços N1

Produto: repositório `pctec-servicos`. Application `PCTEC_CENTRAL_SERVICOS`
(migration 0030), perfis `N1_OPERADOR` e `APROVADOR_TI` (0031).

## Login (SSO com PKCE)

Mesmo fluxo do Portal e do Meu RH: `GET /api/v1/sso/authorize` com
`client_id=PCTEC_CENTRAL_SERVICOS`, PKCE S256 e `redirect_uri` exata de
`SSO_CENTRAL_SERVICOS_REDIRECT_URIS`; troca em `POST /api/v1/service/sso/token`
com a credencial da Central (`x-central-servicos-service-credential`), que
só troca código emitido para a própria Central. Perfil exigido na emissão:
`USER`. Ter perfil de camada 2 é conferido pelo produto, que recusa a
sessão sem nenhum.

## Namespace `/api/v1/service/central-servicos` (credencial da Central)

| Rota | Uso |
|---|---|
| `GET /identities/:id/authorization` | `{fullName, accessProfile, roles}` de PCTEC_CENTRAL_SERVICOS; identidade fora de ACTIVE = sem acesso |
| `POST /delegation-assertions` | `{identityPublicId, ticketId, idempotencyKey, actionKind, contentSha256}` → `{assertion, assertionPublicId, expiresAt}` |

### Por que não um endpoint genérico de perfis

Um `GET /identities/:id/access-profile?application=X` aberto a qualquer
consumidor autenticado deixaria a credencial de UM produto ler acesso e
perfis de pessoas em TODOS os outros. Aqui a aplicação é fixa no código e o
namespace só abre com a credencial da Central: vazar essa credencial expõe o
que a Central já podia ver, e nada além. O próximo produto ganha o seu
contrato fechado do mesmo jeito (ou um genérico que filtre a aplicação pelo
consumidor autenticado — nunca por parâmetro).

### Escopo por cliente

Não mora aqui. A lista de clientes em que cada operador atua é dado do
produto, explícita, conferida no servidor da Central — sem expansão por
grupo empresarial. O Ingressa não conhece clientes do Helpdesk.

## Asserção de delegação (Central → Helpdesk)

Opaca (32 bytes aleatórios), guardada só como SHA-256 em
`delegation_assertions` (0032), amarrada a destinatário `PCTEC_HELPDESK`,
chamado, chave da ação, tipo e hash do conteúdo, com validade
(`INGRESSA_DELEGATION_ASSERTION_TTL_SECONDS`, padrão 3600). Uma por ação.

O Helpdesk verifica em `POST /api/v1/service/helpdesk/delegation-assertions/verify`
(credencial do Helpdesk; audiência fixada pela rota). Respostas, sempre 200:

| status | Significado |
|---|---|
| `VALID` | consumida agora; traz `identityPublicId` |
| `ALREADY_USED` | já consumida — o Helpdesk só aceita se for reenvio da MESMA ação que ele já aplicou |
| `EXPIRED` | vencida |
| `REVOKED` | a pessoa perdeu acesso/perfil entre emissão e uso (não consome) |
| `INVALID` | token desconhecido, audiência errada ou amarração diferente (não consome) |

Nenhuma chamada do Helpdesk existe ainda: a integração do Helpdesk é etapa
futura.
