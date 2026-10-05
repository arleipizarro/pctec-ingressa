# ADR-037 — Recuperação de senha pelo próprio titular ("Esqueci minha senha")

## Contexto

Até aqui, quem perdia a senha não tinha saída sozinho. A única
recuperação existente (`ResetAdminPasswordService`, por CLI e stdin)
serve só ao ADMIN da plataforma, e o restante dependia de alguém operar o
banco ou o servidor. Com o Meu RH trazendo centenas de colaboradores
para o Ingressa, "esqueci a senha" deixa de ser exceção e vira chamado
diário.

## Decisão

### 1. Fluxo e rotas

Rotas **públicas** em `/api/v1/password-reset`, no padrão de
`/api/v1/invitations` (o projeto não usa `/auth/*`):

| Rota | Faz |
|---|---|
| `POST /request` `{ email }` | sempre `202` com a frase neutra; processa depois |
| `POST /preview` `{ token }` | `200 { expiresAt }` ou `401 PASSWORD_RESET_NOT_USABLE`; não consome |
| `POST /confirm` `{ token, password, passwordConfirmation }` | `200` ou `401`/`422` |

UI: link "Esqueci minha senha" no login → `/esqueci-senha` → e-mail com
`<INGRESSA_PUBLIC_BASE_URL>/redefinir-senha#<token>` → nova senha →
`/login` com aviso de sucesso.

### 2. A resposta do pedido não depende do e-mail

Corpo, status **e tempo**. A rota responde `202` antes de consultar
qualquer coisa e só então chama o serviço; se esperasse, um e-mail
cadastrado (transação + SMTP) responderia visivelmente mais devagar que
um inexistente (uma consulta). O desfecho real fica só na auditoria.

### 3. Quem recebe link

Identity `ACTIVE`, `login_enabled = 1` e `Credential LOCAL_PASSWORD`
ativa. Fora disso, nada é emitido e o desfecho é auditado
(`password-reset.requested` com `outcome`):

- `IGNORED_LOGIN_DISABLED` — **sem regra explícita, login desabilitado
  não tem senha redefinida.** Mesma regra do reset administrativo:
  reabilitar login é decisão de ADMIN, com outro fluxo;
- `IGNORED_IDENTITY_NOT_ACTIVE` — PENDING, BLOCKED, INACTIVE;
- `IGNORED_NO_CREDENTIAL` — quem nunca definiu senha está no caminho do
  convite de primeiro acesso;
- `IGNORED_UNKNOWN_EMAIL` — gravado num agregado fixo
  (`00000000-0000-4000-8000-0000000000a2`), **sem o e-mail**.

A conclusão reconfere a conta: se o ADMIN desabilitar o login entre o
pedido e o clique, o link deixa de valer.

### 4. Token

256 bits (`base64url`), só o SHA-256 persistido
(`password_reset_tokens.token_hash`, migration 0034). Viaja no
fragmento da URL, que o navegador não envia ao servidor, e a tela o
apaga da barra antes do primeiro request. Validade padrão de 30 min
(`PASSWORD_RESET_TTL_SECONDS`), teto de 60 min no agregado. Pedido novo
revoga (`SUPERSEDED`) os anteriores na mesma transação; consumo atômico
por `UPDATE … WHERE status = 'PENDING' AND expires_at > ?`. `EXPIRED` é
derivado, como em sessão e convite.

### 5. Conclusão

Uma transação: consome o token, troca o hash da **mesma** Credential
(`Credential.resetPassword`, `reasonCode = SELF_SERVICE_PASSWORD_RESET`),
revoga **todas** as sessões ativas (`PASSWORD_RESET`) e os demais pedidos
abertos, e audita `credential.changed`, `session.revoked` e
`password-reset.completed`. Política de senha (`PlainPassword`) e hasher
(Argon2id) são os existentes, e a política roda **antes** do consumo —
senha curta não queima o link. Nenhuma sessão é criada: o próximo passo
é o login.

### 6. Limitação de tentativas

Três tetos:

- **por IP** e **por IP+e-mail** — o limitador de ADR-034, reaproveitado
  com namespace próprio (`password-reset`), 20 e 5 por hora. Não consome
  o orçamento do login, e o login não consome o dele. As chaves do login
  continuam byte a byte as mesmas;
- **por titular** — no serviço, contando pedidos da Identity na última
  hora (3). Protege a caixa de e-mail da pessoa contra quem dispara o
  formulário a partir de muitos IPs. Só existe quando o e-mail
  corresponde a alguém, e o resultado não aparece na resposta.

### 7. Entrega

Mesmo canal do convite: `INVITATION_DELIVERY_MODE` + `INGRESSA_SMTP_*`,
mesmo transporte (`composeSmtpEmailTransport`). Em `MANUAL_DEV` não há a
quem mostrar o link (o pedido é anônimo), então ele vai para o log do
processo — a **única** exceção a "token nunca em log", aceitável porque
`MANUAL_DEV` é recusado com `NODE_ENV=production`, o link vale no máximo
60 min e a linha não leva o e-mail. `EMAIL` sem SMTP completo falha no
boot, nunca cai para o log.

## Consequências

- Uma identidade PENDING com `login_enabled = 0` **não** é destravada
  por este fluxo, de propósito: a tentativa fica registrada, e quem
  destrava é o ADMIN (ativação + convite). Falta o botão "Ativar" para
  PENDING não federada na tela do admin.
- Falhas de token inválido na conclusão não são auditadas (seria uma
  escrita por requisição de quem chuta tokens); o limitador cobre o
  volume.
- Exige a migration 0034 aplicada antes do deploy: sem a tabela, o
  pedido falha em segundo plano (resposta continua `202`) e a conclusão
  responde `500`.
