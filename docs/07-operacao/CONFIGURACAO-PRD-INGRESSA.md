# PCTEC Ingressa — Configuração de produção (v1.0)

Referência operacional para provisionar o Ingressa em produção. Trata
apenas de **nomes** de variáveis, decisões e ordem de execução.

> **Nenhum valor real aparece aqui, e nenhum deve ser acrescentado.**
> Host, usuário, senha, remetente e credenciais de serviço vivem
> exclusivamente no `.env` do servidor, com permissão `0600`, fora do
> Git.

## Estado desta entrega

Este documento acompanha a fatia de *production readiness*. Na data em
que foi escrito **não existia ambiente de produção do Ingressa** — nem
diretório, nem banco, nem processo, nem vhost. O que segue é o contrato
a ser aplicado quando ele for criado.

## 1. Sessão

| Variável | Valor de PRD | Por quê |
|---|---|---|
| `SESSION_TTL_SECONDS` | **`28800`** (8 h) | Decisão operacional registrada. `loadEnv()` **exige** esta variável explicitamente em produção — o default de 8 h é pensado para development/test e nunca se aplica sozinho lá. 28800 alinha o Ingressa ao TTL de sessão do Portal, para que as duas sessões não expirem em momentos distantes e produzam um "meio-deslogado" difícil de explicar. |
| `SESSION_COOKIE_SECURE` | `true` | `false` é recusado incondicionalmente em produção, mesmo que a variável tente forçar. |

O cookie é `ingressa_session`: `HttpOnly` (fixo, não configurável),
`SameSite=Lax`, `Path=/`, `Expires` derivado da expiração real no
servidor.

## 2. SMTP — origem operacional e mapeamento

### A decisão

O Ingressa está autorizado a **reutilizar a caixa SMTP do PCTEC Hub**.
O desenho original previa SMTP próprio e independente; essa preferência
continua correta e permanece o destino, mas provisionar uma caixa nova
não era pré-requisito para o Ingressa existir.

### Como a cópia é feita

Os valores são copiados **uma única vez, à mão**, do `.env` do Hub para
o `.env` do Ingressa, **traduzindo os nomes**:

| Origem (PCTEC Hub) | Destino (PCTEC Ingressa) |
|---|---|
| `SMTP_HOST` | `INGRESSA_SMTP_HOST` |
| `SMTP_PORT` | `INGRESSA_SMTP_PORT` |
| `SMTP_USER` | `INGRESSA_SMTP_USER` |
| `SMTP_PASS` | `INGRESSA_SMTP_PASSWORD` |
| `SMTP_FROM` | `INGRESSA_SMTP_FROM` |
| *(não existe no Hub)* | `INGRESSA_SMTP_SECURE` |

Regras que não se negociam:

- o `.env` do Hub é **somente leitura** — nunca alterado, movido,
  reformatado ou exibido;
- **nunca um symlink** entre os dois arquivos. Um symlink transformaria
  uma decisão operacional reversível numa dependência de runtime entre
  dois produtos;
- **o processo do Ingressa nunca abre o arquivo do Hub.** Em runtime ele
  só conhece as próprias `INGRESSA_SMTP_*`;
- **nenhuma outra variável do Hub é copiada.** Só as cinco acima.

### ⚠️ Limitação aceita: rotação acoplada

A caixa é a mesma para os dois produtos. Portanto:

> **Rotacionar a senha SMTP no Hub quebra o envio de convites do
> Ingressa até que o novo valor seja copiado para o `.env` do Ingressa —
> e vice-versa.**

Consequências práticas de quem opera:

- toda rotação vira uma tarefa de **dois** sistemas, nunca de um;
- o sintoma no Ingressa é `INVITATION_DELIVERY_FAILED` (HTTP 503) na
  tela de convites — não é queda do serviço, e autenticação, `/health` e
  todas as demais rotas continuam funcionando;
- o caminho para eliminar o acoplamento é provisionar uma caixa própria
  do Ingressa e trocar os cinco valores. Nada em código muda: os nomes
  já são próprios.

### `INGRESSA_SMTP_SECURE` — contrato novo, valor ainda pendente

O Hub não tem variável de TLS/secure, então este contrato nasce aqui:

- `true` → TLS implícito, conexão já nasce cifrada (porta **465**);
- `false` → conexão elevada por STARTTLS (porta **587**);
- **ausente** → derivado da porta (465 → `true`, qualquer outra →
  `false`).

A derivação nunca enfraquece a conexão: com `NODE_ENV=production` o
backend aplica `requireTLS`, de modo que uma omissão jamais resulta em
senha ou link de convite trafegando em claro.

**Valor operacional ainda faltante:** confirmar a porta usada pela caixa
do Hub e, se ela não for 465 nem 587, definir `INGRESSA_SMTP_SECURE`
explicitamente. Não foi possível determinar isso sem ler o valor do
`.env` do Hub, o que este processo não autoriza.

## 3. Convites

| Variável | Valor de PRD |
|---|---|
| `INVITATION_DELIVERY_MODE` | `EMAIL` |
| `INVITATION_TTL_SECONDS` | opcional (24 h por padrão, teto de 7 dias no domínio) |

`MANUAL_DEV` é recusado incondicionalmente em produção: mostrar o link
do convite na tela de quem administra é recurso de desenvolvimento, não
política de entrega de acesso.

Comportamento em falha, por desenho:

- **configuração incompleta derruba o boot**, citando os nomes das
  variáveis ausentes — nunca os valores, nunca um fallback silencioso
  para `MANUAL_DEV`;
- **falha de envio não derruba nada.** Nenhuma conexão SMTP é aberta no
  boot e `verify()` nunca é chamado. Um SMTP fora do ar afeta só a
  operação de convite, que pode ser repetida.

## 4. Rede, origens e integrações

| Variável | Observação |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `127.0.0.1` — o processo nunca escuta em `0.0.0.0`; quem expõe é o Nginx |
| `PORT` | porta local livre |
| `INGRESSA_PUBLIC_BASE_URL` | URL pública `https://…`. É daqui que sai o link do convite — **nunca do request** |
| `ALLOWED_ORIGINS` | domínio(s) oficiais, separados por vírgula. **Precisa conter o domínio público do Ingressa**, exatamente como o navegador o envia, ou toda rota mutável (inclusive o logout) responde `403 CSRF_ORIGIN_REJECTED` |

Variáveis do canal com o Portal — `INGRESSA_PORTAL_SERVICE_CREDENTIAL`,
`SSO_PORTAL_REDIRECT_URIS`, `SSO_PORTAL_LAUNCH_URL` — ficam **ausentes**
enquanto o Ingressa estiver isolado. Ausentes, elas são *fail-closed*: a
rota `/api/v1/service/portal/...` fica indisponível e o SSO do Portal
não é oferecido. É o estado correto até a virada do Portal, não uma
pendência.

## 5. Bootstrap da primeira Identity ADMIN

Ver **ADR-027, emenda v1.0**. Resumo operacional:

```bash
cd backend && npm run build

# uma vez por comando, NUNCA no .env:
INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP=YES node dist/cli/bootstrap-first-identity.js
INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP=YES node dist/cli/bootstrap-first-admin-access.js
INGRESSA_ALLOW_PRODUCTION_BOOTSTRAP=YES node dist/cli/bootstrap-first-credential.js
```

Em produção, cada comando exige TTY e uma frase que nomeia o alvo:

```
PRODUCTION <FRASE_BASE> <database> <hostname>
```

Se o database ou o hostname exibidos não forem o alvo pretendido,
**cancele**: o `.env` carregado não é o daquele servidor.

Interrupção entre comandos é segura — reexecute o passo que faltou. As
pré-condições nos serviços impedem uma segunda Identity, um segundo
ADMIN e a substituição de uma Credential.

**SQL manual para criar Identity, ApplicationAccess ou Credential é
proibido em qualquer ambiente**, inclusive sob urgência.

## 6. Proteção do arquivo

O `.env` de produção fica com permissão `0600` e dono igual ao usuário
que roda o processo. Nenhuma variável de segredo aparece em log de boot:
erros de configuração citam **nomes**, nunca valores.

Atenção ao carregar o `.env` via `--env-file` do Node: **o valor é
truncado no primeiro `#`**. Nenhum segredo de produção pode conter esse
caractere.
