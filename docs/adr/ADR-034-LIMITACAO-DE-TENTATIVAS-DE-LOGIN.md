# ADR-034 — Limitação de tentativas de login com contadores compartilhados em MariaDB

## Contexto

`POST /api/v1/sessions` não tinha limite algum de tentativas. Qualquer
pessoa com a URL podia enviar requisições indefinidamente, e cada uma
delas custava um Argon2id completo — o custo existe justamente para ser
alto, o que transforma a ausência de limite em duas coisas ao mesmo
tempo: convite à adivinhação de senha e vetor de esgotamento de CPU.

Enquanto o Ingressa servia um punhado de administradores, o risco era
teórico. A fundação do PCTEC Meu RH muda a escala: 167 colaboradores com
credencial, e senhas escolhidas por pessoas, não por operadores de
plataforma. Fechar isso antes de ampliar o público é pré-requisito, não
melhoria.

## Decisão

### 1. Contadores compartilhados em MariaDB — nunca memória de processo

Auditoria do ambiente **antes** de escolher:

| Verificação | Resultado |
|---|---|
| `redis-server` / `redis-cli` instalados | não |
| serviço `redis` / `redis-server` | inativo |
| `redis` / `ioredis` em `package.json` | ausente em **todos** os produtos do parque |
| Ingressa em PM2 | `exec_mode: fork`, `instances: 1` |

**Memória do processo foi descartada, e não adiada.** Um contador local
deixa de ser proteção no dia em que subirem dois workers: o teto efetivo
vira "limite × workers", e nada no sistema sinaliza que a garantia
mudou. Pior, todo `pm2 restart` zera os contadores — o que um atacante
paciente aproveita de graça. Uma proteção que se desfaz sem avisar é
pior que nenhuma, porque produz confiança injustificada.

**Redis não foi introduzido**, e nem precisaria de discussão: exigiria
autorização para novo componente de infraestrutura, e o MariaDB já É o
ponto de coordenação compartilhado deste sistema — sessões, códigos de
autorização de uso único, chaves únicas de concorrência. Um contador por
tentativa de login é escrita pequena, indexada por chave primária, na
mesma ordem de grandeza do que o próprio login já faz. Nenhum componente
novo, e o desenho já é compatível com execução distribuída.

### 2. Dois escopos, e por que o segundo inclui o IP

| Escopo | Chave | Default | Contra o quê |
|---|---|---|---|
| `IP` | `sha256("ip" ‖ ip)` | 60 / 15 min | varredura de muitos e-mails de uma origem |
| `IP_IDENTIFIER` | `sha256("ip-identifier" ‖ ip ‖ e-mail normalizado)` | 10 / 15 min | adivinhação de senha de uma pessoa |

Só por IP não protege contra adivinhação: quem tenta 60 senhas distribui
entre 60 e-mails e nunca encosta no teto apertado. Só por e-mail protege
contra adivinhação, mas **cria uma arma**: qualquer pessoa que conheça
um e-mail tranca aquela conta de qualquer lugar do mundo, só errando a
senha algumas vezes — negação de serviço direcionada, entregue de graça.

Combinar `(IP + identificador)` fecha os dois: adivinhar a senha de
alguém exige muitas tentativas contra o mesmo e-mail, e todas caem no
mesmo contador; e trancar a conta de outra pessoa passa a exigir
controle do IP dela, o que já não é ataque à distância.

O teto por IP é generoso de propósito: um escritório inteiro sai por um
NAT só, e apertar ali transformaria um dia normal em indisponibilidade
para todo mundo atrás daquele endereço.

### 3. Conta TENTATIVAS e estorna no sucesso

Contar só falhas parece mais preciso e é pior em dois pontos. A falha só
é conhecida **depois** do Argon2id, então cada tentativa barrada ainda
custaria o hash — o limitador não protegeria a CPU, que é metade do
motivo de existir. E contar depois obriga a registrar o resultado fora do
caminho da requisição, o que abre corrida entre respostas paralelas.

Contando a tentativa **antes**, a decisão sai de uma escrita atômica e
nada caro acontece quando o teto já estourou. O custo — uso legítimo
consumindo orçamento — é devolvido por um estorno quando a resposta é
`201`, o único desfecho em que se sabe que não era ataque. Um ataque,
por definição, quase nunca acerta, então o estorno praticamente não
beneficia quem tenta adivinhar.

### 4. Não cria enumeração de usuários

A decisão acontece **antes de qualquer consulta a `identities`**. Nada
no caminho do limitador sabe — nem pode saber — se o e-mail enviado
corresponde a alguém. E-mail cadastrado e e-mail inventado produzem o
mesmo contador, o mesmo limite, o mesmo `429`, o mesmo `Retry-After` e o
mesmo corpo de resposta.

A mensagem também não diz **qual** limite estourou: saber se foi o de
origem ou o de origem+e-mail já diria algo sobre o que mais está
acontecendo no sistema.

### 5. Resposta

`429 Too Many Requests`, com `Retry-After` em segundos e o envelope de
erro padrão da API:

```json
{ "error": { "code": "LOGIN_RATE_LIMITED",
             "message": "Muitas tentativas de autenticação. Tente novamente mais tarde.",
             "correlation_id": "…", "details": [] } }
```

### 6. Falha FECHADO

Erro ao consultar o contador vira `503 LOGIN_RATE_LIMIT_UNAVAILABLE`,
nunca "deixa passar". O armazenamento é o mesmo banco que autentica: se
ele está fora, o login não funcionaria de qualquer jeito, então falhar
fechado não custa disponibilidade nenhuma. Falhar aberto transformaria
qualquer instabilidade momentânea numa janela sem proteção — e é
justamente durante a instabilidade que ninguém está olhando.

### 7. Nada sensível é armazenado ou registrado

A chave do contador é o **digest** do escopo. Nem IP, nem e-mail, nem
senha, nem token — nada em claro. A tabela precisa saber que duas
tentativas vieram do mesmo lugar; não precisa saber de onde, e em
particular **jamais é uma lista de e-mails que tentaram entrar**.

Senha e token não são lidos, gravados nem registrados por este caminho
em momento nenhum.

### 8. Auditoria: só na transição

Evento `auth.rate-limit.blocked`, emitido **apenas** na requisição que
cruza o limite — nunca nas seguintes da mesma janela. Auditar toda
requisição barrada entregaria a quem ataca uma escrita em banco por
requisição: o limitador viraria amplificador do ataque que existe para
conter. Uma linha por contador por janela é um teto conhecido.

Payload: `scopeKind`, `limit`, `windowSeconds`. **Sem IP, sem e-mail e
sem o digest** — o espaço de endereços IPv4 é pequeno o bastante para ser
percorrido inteiro em minutos, então gravar o digest de um IP é gravar o
IP com um passo a mais; e-mail idem, para quem tem a lista de
colaboradores. Investigar um caso específico é trabalho do log de borda
(Nginx), que já tem o IP legitimamente e com retenção própria — não do
registro permanente de auditoria do servidor de identidade.

### 9. Origem da requisição

Resolução **local e explícita**, sem `app.set("trust proxy", …)`: o
ajuste global também passa a derivar `req.protocol`/`req.secure` de
`X-Forwarded-Proto`, o que afeta decisões de cookie e redirecionamento em
toda a aplicação. Ligar isso para resolver rate limiting seria mudar o
comportamento de partes que não pediram nada.

`TRUSTED_PROXY_HOP_COUNT` tem default **0** — não confia em
`X-Forwarded-For` nenhum. É o único default seguro: o header é escrito
pelo cliente antes de qualquer proxy, e confiar nele sem saber a
profundidade da cadeia entrega ao atacante a escolha do próprio
contador — bastaria um header novo por tentativa.

> **Ação obrigatória por ambiente:** em DEV e em PRD o Ingressa fica
> atrás de um Nginx, então o valor correto lá é **1**. Com 0, todas as
> requisições chegam como `127.0.0.1` e o contador por origem vira um
> contador global.

### 10. Nada de CAPTCHA

Fora de escopo por decisão explícita. CAPTCHA introduz dependência de
terceiro, custo de acessibilidade e uma tela nova no fluxo de
autenticação — nenhuma dessas coisas é necessária para fechar a lacuna
que este ADR fecha.

## Configuração

| Variável | Default | Papel |
|---|---|---|
| `LOGIN_RATE_LIMIT_ENABLED` | `true` | escotilha operacional; ligado por padrão |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `900` | janela de contagem |
| `LOGIN_RATE_LIMIT_MAX_PER_IP` | `60` | teto por origem |
| `LOGIN_RATE_LIMIT_MAX_PER_IP_IDENTIFIER` | `10` | teto por origem+identificador |
| `TRUSTED_PROXY_HOP_COUNT` | `0` | proxies confiáveis à frente (**1** em DEV/PRD) |

Default ligado de propósito: um limitador que só protege quando alguém
lembra de ligar não é proteção, e o dia de esquecer é sempre o dia
errado.

## Operação

**Ordem de implantação.** O limitador falha fechado, então a migration
`0025_create_auth_rate_limit_counters` precisa ser aplicada **antes** de
subir o build que a usa — a ordem já prevista no runbook de migrations.
Se algo der errado, a escotilha é `LOGIN_RATE_LIMIT_ENABLED=false`.

**Retenção.** Linhas de escopos que nunca mais voltam permanecem. A
limpeza é rotina operacional, por idade, servida por
`idx_auth_rate_limit_window`:

```sql
DELETE FROM auth_rate_limit_counters
 WHERE window_started_at < NOW(3) - INTERVAL 7 DAY;
```

Remover contador antigo é seguro por construção: uma janela expirada já
reiniciaria na próxima tentativa, e a linha não guarda nada além de uma
contagem.

## Consequências

- `POST /api/v1/sessions` ganha dois desfechos novos: `429` e `503`.
  Clientes que tratavam apenas `201`/`401` precisam considerá-los.
- Testes que exercitam o login pela rota precisam declarar um contador
  (há um dublê em memória em `security/tests/`) — o limitador não é
  desligado silenciosamente em teste, de propósito.
- Uma escrita adicional por tentativa de login. Indexada por chave
  primária, desprezível perto do Argon2id que ela protege.
- O limitador **não** protege contra ataque distribuído por muitos IPs
  contra muitos e-mails. Contra isso, o instrumento é o teto por
  `(IP + identificador)`, que continua valendo por origem, mais o que a
  borda (Nginx/WAF) puder fazer. Registrado como limitação conhecida,
  não como lacuna esquecida.

## Status

Aceito na fundação do PCTEC Meu RH. Migration 0025 aplicada em DEV;
**não** aplicada em PRD por esta entrega.

Relacionadas: ADR-029 (Credential e autenticação), ADR-030 (sessão e
autenticação — de onde vem a uniformidade de resposta que este ADR
preserva).
