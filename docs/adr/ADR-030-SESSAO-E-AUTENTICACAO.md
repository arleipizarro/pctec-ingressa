# ADR-030 — Sessão e Autenticação (Fase D da ADR-027)

## Contexto

A ADR-027 previu quatro fases: A (Identity fundacional, concluída no DEV
real), B (`ApplicationAccess` administrativo, concluída no DEV real), C
(`Credential`, concluída — implementação aprovada, publicação em
andamento), D (primeiro login real — **esta ADR**). O estado operacional
real do DEV, no momento desta ADR: Identity fundacional `ACTIVE`,
`loginEnabled=true`, `Credential LOCAL_PASSWORD ACTIVE`, `ApplicationAccess
PCTEC_INGRESSA/ADMIN/GRANTED` — ou seja, todos os pré-requisitos de dados
para um primeiro login real já existem, mas **nenhum mecanismo de sessão
ou autenticação HTTP existe em código**.

Esta ADR resolve exclusivamente o **desenho** de `POST /api/v1/sessions`:
o modelo de sessão, como a senha é verificada, como a sessão é
transportada, o boundary entre autenticação e autorização, proteção
contra enumeração e timing attacks, e o contrato de erro. **Nenhum código
é implementado nesta entrega.**

## Conflitos reais encontrados — resolvidos nesta ADR

### 1. `IDENTITY_LOGIN_DISABLED`/`IDENTITY_BLOCKED` como códigos externos distintos

`API-CONTRACT-V1.md` (v0.2.0, seção 7) lista, como erros esperados de
`/api/v1/sessions`: `INVALID_CREDENTIALS`, `IDENTITY_LOGIN_DISABLED`,
`IDENTITY_BLOCKED`, `SESSION_NOT_FOUND` — **quatro códigos externos
distintos e observáveis pelo cliente**. Isso contradiz diretamente o
princípio já fixado em ADR-029 ("Proteção contra enumeração de usuário"):
o contrato externo deve ser **indistinguível** para "e-mail inexistente",
"senha incorreta", "identidade bloqueada", "login desabilitado" — todos
esses fatos, se expostos separadamente, permitem a um atacante confirmar
que um e-mail específico está cadastrado e inferir seu estado
administrativo.

**Resolução:** `API-CONTRACT-V1.md` é corrigido (nota de correção, não
reescrita) — os quatro códigos conceituais de erro do login colapsam
externamente em **um único** `AUTHENTICATION_FAILED` (ver seção "Erros"
abaixo). `SESSION_NOT_FOUND` permanece separado, mas usado num contexto
diferente (validação de uma sessão já estabelecida em requisições
subsequentes, não no login em si — ver "Proteção contra enumeração"
abaixo para a distinção completa).

### 2. Ausência de classificação HTTP 401 no catálogo de erros de domínio

`DomainErrorClassification` (código atual, `shared/errors/DomainError.ts`)
só define `"VALIDATION" | "CONFLICT" | "AUTHORIZATION"` — mapeadas para
422/409/403 respectivamente (`mapDomainErrorToHttp.ts`). **Não existe
classificação para 401 (Unauthorized).** `AUTHENTICATION_FAILED`,
`SESSION_EXPIRED`, `SESSION_REVOKED` semanticamente pedem 401, não 403
(`AUTHORIZATION`, que significa "autenticado mas sem permissão" — 401
significa "não autenticado ou credencial inválida", categoria diferente).

**Resolução:** quando a Fase D for implementada, `DomainErrorClassification`
precisará ganhar um quarto valor (`"AUTHENTICATION"` → 401) — extensão
aditiva, não removida nenhuma classificação existente. Registrado aqui
como requisito de implementação, não implementado nesta ADR (documental).

**Distinção formal entre as duas classificações (revisão crítica —
framing explícito):**

| Classificação | HTTP | Pergunta que responde |
|---|---|---|
| `AUTHENTICATION` | 401 | "Quem é você? / Sua prova de identidade é inválida ou ausente." |
| `AUTHORIZATION` | 403 | "Você está autenticado — mas não pode fazer isto." |

`401` (`AUTHENTICATION`) é usado quando não há prova válida de identidade
(login falhou, sessão ausente/expirada/revogada). `403` (`AUTHORIZATION`,
já existente desde antes desta ADR) é usado quando a identidade já foi
provada, mas a ação requer uma permissão que essa identidade não tem —
categoria totalmente diferente, nunca confundida com a anterior. Todos
os erros desta ADR (`AUTHENTICATION_FAILED`, `SESSION_NOT_FOUND`,
`SESSION_EXPIRED`, `SESSION_REVOKED`) pertencem a `AUTHENTICATION`
(401) — nenhum deles é sobre permissão, todos são sobre "não sei quem
você é" ou "sua prova não é mais válida".

### 3. Modelo `Session`/`RefreshToken` já existente — não inventar alternativa

`MODELO-DE-DOMINIO.md` (v0.2.0, seções 11-12) já documenta `Session` e
`RefreshToken` (com rotação) como entidades conceituais separadas — não
inventado agora. A task pediu para comparar explicitamente modelos de
sessão sem "escolher JWT automaticamente"; a preferência inicial indicada
(sessão opaca server-side) **já é consistente** com o que os documentos
de v0.2.0 preveem — a diferença é que esses documentos já anteciparam
também um `RefreshToken` rotativo, que esta ADR decide **diferir** para
uma fase futura (ver seção "Session model" abaixo) — não descartado,
apenas fora do escopo de implementação da Fase D.

## Questões respondidas (task, seção 34)

### 1. Stateful ou JWT? / 2. Por quê?

**Stateful — sessão server-side opaca.** Comparação explícita:

| Critério | A. Stateful opaca | B. JWT stateless | C. Access+Refresh (JWT ou opaco) |
|---|---|---|---|
| Revogação imediata | Trivial (`UPDATE status='REVOKED'`) | **Impossível sem blocklist** (anula a vantagem de ser stateless) | Access token ainda vaza até expirar; revogação real só no refresh |
| Logout real | Trivial | Requer blocklist (= stateful de novo) | Idem — access token continua válido até expirar |
| Invalidar após troca de `Credential`/`loginEnabled=false` | Trivial (mesma revogação) | Impossível sem blocklist | Mesma limitação de B para o access token |
| Auditoria (quem está logado agora) | Trivial (`SELECT WHERE status='ACTIVE'`) | Impossível sem store paralelo | Precisa do mesmo store paralelo |
| Simplicidade de implementação | Alta | Média (assinatura, chaves, validação) | Baixa (dois mecanismos, rotação) |
| Escalabilidade horizontal | Exige lookup em banco a cada requisição (mitigável com cache) | Nenhum lookup necessário | Idem A para o access token quando validado no servidor |
| Múltiplas aplicações (futuro ecossistema PCTEC) | Simples — outra aplicação consulta a mesma tabela `sessions` | Precisaria compartilhar segredo de assinatura entre serviços, ou introspecção centralizada (reintroduz stateful) | Mesmo trade-off de B |
| Compatível com browser (cookie) e APIs futuras (bearer) | Sim, ambos | Sim, ambos | Sim, ambos |

**Decisão: A (stateful opaca).** O critério decisivo é revogação real —
a plataforma precisa poder invalidar sessões imediatamente após mudança
de `Credential`, `loginEnabled=false`, ou ação administrativa
(`BLOCKED`), sem esperar expiração. JWT puro (B) não permite isso sem
reintroduzir um store server-side para revogação — nesse ponto, deixa de
ser "stateless" na prática e apenas adiciona complexidade de assinatura
sem ganho real. C (access+refresh) tem o mesmo problema de janela de
vazamento do access token até expirar; só compensa em sistemas com
volume/latência que tornam lookup por requisição proibitivo — não é o
caso desta plataforma nesta fase.

### 3. Cookie ou Bearer?

**Cookie `HttpOnly` para o frontend web do Ingressa** — reduz exposição
do token a `XSS` (JavaScript não consegue ler um cookie `HttpOnly`, então
mesmo um `XSS` bem-sucedido não rouba a sessão diretamente). `Bearer`
(header `Authorization`) permanece **desenhado, não implementado nesta
fase**, para consumidores futuros que não sejam o browser (ex.: um
aplicativo mobile, integração serviço-a-serviço) — o mesmo `Session`
serve para ambos os transportes, a diferença é só onde o token viaja.

### 4. Como o token é gerado?

`crypto.randomBytes(32)` (Node.js nativo) → 256 bits de entropia
criptográfica → codificado em formato seguro para URL/cookie (ex.:
base64url). Nunca um UUID (UUID v4 tem só ~122 bits de entropia efetiva e
não foi desenhado para ser um segredo criptográfico).

### 5. O que é persistido?

Apenas o **hash** do token (`SHA-256`), nunca o valor bruto — mesmo
princípio já aplicado a `Credential.password_hash`. Verificação: hash do
token recebido no cookie/header, comparação com o hash armazenado.
`SHA-256` simples (não `Argon2id`) é suficiente aqui porque o token de
sessão já tem entropia alta o bastante (256 bits) para não ser
alvo de força bruta viável — diferente de senha, que é escolhida por
humanos e tem entropia baixa, exigindo um algoritmo de custo alto
(`Argon2id`) especificamente para compensar isso.

### 6. Como logout funciona?

`DELETE /api/v1/sessions/current` (ou equivalente canônico) — revoga a
sessão **no servidor** (`status = 'REVOKED'`, `revoked_at = now()`),
depois instrui o cliente a apagar o cookie. Nunca depende só de apagar o
cookie no cliente — um cookie apagado localmente não invalida a sessão
no servidor; sem a revogação server-side, o token (se capturado antes do
logout) continuaria válido até expirar.

**Fluxo formalizado em 4 passos (revisão crítica — explícito, não
implícito):**

1. **Lê a sessão atual** — resolve qual `Session` corresponde ao token
   recebido (cookie/header) na própria requisição de logout (o "current"
   em `/sessions/current` refere-se exatamente a essa resolução — nunca
   um `sessionPublicId` arbitrário informado pelo cliente).
2. **Marca a sessão como `REVOKED`** — `UPDATE sessions SET
   status='REVOKED', revoked_at=NOW(), revocation_reason='LOGOUT' WHERE
   public_id=?`, emite `session.revoked`.
3. **Limpa o cookie** — instrui o navegador a descartar o cookie de
   sessão (`Set-Cookie` com `Max-Age=0`/data de expiração no passado).
4. **Não depende apenas do passo 3** — mesmo que o cliente ignore ou
   perca a instrução de limpeza do cookie (ex.: um bug no cliente, ou o
   cookie sendo copiado antes da resposta chegar), o passo 2 já garante
   que o token não é mais aceito pelo servidor em nenhuma requisição
   futura.

### 7. Como expiração funciona?

**Expiração absoluta nesta fase** (ex.: sessão válida por N horas fixas
desde a criação, não renovável automaticamente) — mais simples,
suficiente para o MVP. *Sliding expiration* (renovar `expires_at` a cada
uso) e o `RefreshToken` rotativo já documentado ficam para uma fase
futura — ver "O que fica para implementação futura" abaixo. `EXPIRED` não
é um valor de `status` persistido e verificado por job — é **estado
derivado**: `status = 'ACTIVE' AND expires_at > NOW()` no momento da
validação (ver seção "Session status" abaixo).

### 8. O que `AuthenticatedPrincipal` contém?

```
AuthenticatedPrincipal {
  identityPublicId: string;
  sessionPublicId: string;
}
```

Nada além disso — sem `ADMIN`, sem `applicationAccesses`, sem `roles`,
sem `permissions`. Mesmo princípio já fixado em ADR-029 para
`AuthenticatedIdentity` (que este tipo estende com o `sessionPublicId`,
já que agora existe uma sessão real, não apenas uma identidade provada).

### 9. Onde `ApplicationAccess` entra?

**Depois** da autenticação, nunca dentro dela. Um middleware/serviço de
autorização futuro (`AuthorizationService` ou equivalente, não
desenhado em detalhe nesta ADR) consulta `ApplicationAccessRepository`
separadamente, usando `identityPublicId` do `AuthenticatedPrincipal` já
resolvido — mesmo padrão de separação já adotado em ADR-029.
`CreateSessionService` (ver abaixo) **nunca** consulta
`ApplicationAccess`.

### 10. Como prevenir enumeração?

Ver seção dedicada "Proteção contra enumeração" abaixo.

### 11. Como reduzir timing leak?

Ver seção dedicada "Timing attacks" abaixo.

### 12. O que ocorre se `loginEnabled=false`?

`AuthenticateIdentityService` rejeita — mesma resposta externa genérica
`AUTHENTICATION_FAILED` de qualquer outra causa de falha (nunca "login
desabilitado" como mensagem distinta externamente). Internamente, o
motivo real (`reason: "LOGIN_NOT_ENABLED"`) é registrado para
auditoria/telemetria — mesmo princípio já fixado em ADR-029.

### 13. O que ocorre se `Credential` for revogada?

Mesma resposta externa genérica. Internamente: `reason:
"CREDENTIAL_REVOKED"`. Ver também seção "Credential change" abaixo para
o efeito sobre sessões **já existentes** (pergunta diferente desta).

### 14. Como sessão é invalidada?

Quatro formas, todas via `UPDATE sessions SET status='REVOKED',
revoked_at=?, revocation_reason=?`:

1. Logout explícito do próprio usuário (`revocation_reason = 'LOGOUT'`).
2. Expiração natural (`status` permanece `ACTIVE`, mas `expires_at <
   NOW()` faz a validação tratá-la como inválida — não precisa de
   `UPDATE`, é derivado, ver questão 7).
3. Ação administrativa futura (bloquear a Identity, revogar `Credential`)
   — **regra arquitetural definida, não implementada nesta fase** (ver
   "Credential change" abaixo).
4. Detecção de reuso de `RefreshToken` já rotacionado (mecanismo de
   segurança já previsto em `MODELO-DE-DOMINIO.md`, seção 12) — só
   relevante quando `RefreshToken` for implementado (fase futura).

### 15. Quais eventos existem?

Ver seção "Eventos" abaixo.

### 16. Quais erros existem?

Ver seção "Contrato de erro" abaixo.

### 17. Como rate limiting entra?

Ver seção dedicada "Rate limiting" abaixo — avaliado, não implementado
nesta fase, com roadmap registrado (não deixado como lacuna muda).

### 18. Quais decisões ficam para implementação?

Ver seção "O que fica para implementação futura" ao final.

## Session model — decisão final

**Sessão server-side opaca (Modelo A), sem `RefreshToken` nesta fase.**
Justificativa completa na tabela comparativa acima. `RefreshToken` (já
modelado conceitualmente, `MODELO-DE-DOMINIO.md` seção 12) é adiado — a
tabela `sessions` e o desenho aqui não impedem adicioná-lo depois (ele
referencia `session_id`, é aditivo).

### Session — modelo de domínio

| Atributo | Tipo | Observação |
|---|---|---|
| `internalId` | `number` | Interno, nunca exposto (ADR-021). |
| `publicId` | `PublicId` (UUID) | Externo, imutável — é o que aparece em eventos/auditoria (nunca é o segredo em si — ver nota abaixo). |
| `identityPublicId` | `string` | Referência direta a `Identity` (mesmo padrão de `Credential`/`ApplicationAccess`). |
| `tokenHash` | `string` | `SHA-256` do token opaco de 256 bits — nunca o token em texto. |
| `status` | `'ACTIVE' \| 'REVOKED'` | `EXPIRED` NÃO é um valor persistido — ver "Session status" abaixo. |
| `createdAt` | `Date` | |
| `expiresAt` | `Date` | Expiração absoluta, fixada na criação. |
| `lastSeenAt` | `Date \| undefined` | Atualizado a cada uso válido — avaliação de custo/benefício de write-a-cada-requisição fica para implementação (ex.: atualizar só se a diferença for maior que N minutos, para reduzir volume de `UPDATE`s). |
| `revokedAt` | `Date \| undefined` | |
| `revocationReason` | `string \| undefined` | Enum fechado quando implementado (`LOGOUT`, futuros: `ADMIN_ACTION`, `CREDENTIAL_CHANGED`, `SECURITY_EVENT`). |
| `version` | `number` | Optimistic locking (ADR-024), por consistência. |

**Nota sobre o valor do cookie/header vs. `publicId`:** o valor entregue
ao cliente **não é** o `publicId` da sessão — é o **token opaco bruto**
(256 bits, gerado por `crypto.randomBytes`). `publicId` é o identificador
que a plataforma usa internamente/em eventos/auditoria (nunca é o
segredo). O cliente nunca vê o `publicId` como segredo de autenticação;
o token é o segredo, e só seu hash é armazenado. Na prática, o
`publicId` PODE aparecer no corpo de resposta do login (ver contrato
abaixo) — isso é seguro porque `publicId` sozinho não autentica nada, só
o token (que o cliente já possui, fora do JSON, no cookie).

### Session status — sem redundância

**Apenas `ACTIVE`/`REVOKED` persistidos.** `EXPIRED` é **estado
derivado** (`status = 'ACTIVE' AND expires_at <= NOW()`), nunca escrito
por nenhum comando — evita: (a) um job periódico só para marcar sessões
expiradas (trabalho desnecessário, sessões expiradas simplesmente param
de validar); (b) inconsistência entre o horário do job e o horário real
de expiração. A validação de uma sessão em qualquer requisição futura já
precisa checar `expires_at` de qualquer forma — reaproveita a mesma
checagem, sem duplicar estado.

**Formalização explícita (revisão crítica — não deixar implícito):**
`status = 'ACTIVE'` com `expiresAt` no passado **é semanticamente uma
sessão expirada e não autenticável** — a linha continua fisicamente com
`status='ACTIVE'` no banco (nenhum `UPDATE` a transforma em outra coisa),
mas toda validação de sessão (login, middleware futuro, qualquer
consulta) trata essa combinação como inválida para fins de autenticação.
Persistir um terceiro valor de `status` só para marcar isso seria
redundante: a informação "está expirada" já está inteiramente contida em
`expiresAt <= NOW()`, calculável a qualquer momento sem custo adicional
— nenhum job precisa rodar para "atualizar" esse estado, porque não há
estado adicional a atualizar.

## `AuthenticateIdentityService` — fluxo formal

```
AuthenticateIdentityService.execute({ email: string, password: string }): Promise<AuthenticatedIdentity>

AuthenticatedIdentity {
  identityPublicId: string;
}
```

Fluxo (task, seção 10, confirmado):

```
1. Normaliza o e-mail (mesma normalização de Identity.email_normalized).
2. SELECT Identity WHERE email_normalized = ? — não encontrada → falha genérica (ver enumeração).
3. Identity.status !== 'ACTIVE' → falha genérica.
4. Identity.loginEnabled !== true → falha genérica.
5. SELECT Credential WHERE identity_public_id = ? AND type = 'LOCAL_PASSWORD' — não encontrada → falha genérica.
6. Credential.status !== 'ACTIVE' → falha genérica.
7. Argon2id.verify(password, credential.passwordHash) — falso → falha genérica.
8. Sucesso: atualiza credential.lastAuthenticatedAt = now() (ver seção dedicada abaixo).
9. Retorna AuthenticatedIdentity { identityPublicId }.
```

**Nunca resolve `ApplicationAccess`** — confirmado, questão 9.

## `CreateSessionService` — separado de `AuthenticateIdentityService`

Dois serviços distintos, nunca fundidos num só — mesma separação de
responsabilidade única já praticada em toda a base (`BootstrapFirst*Service`
nunca mistura duas responsabilidades):

```
CreateSessionService.execute({ identityPublicId: string }): Promise<CreatedSession>

CreatedSession {
  sessionPublicId: string;
  rawToken: string;      // só existe neste retorno — nunca persistido, nunca logado
  expiresAt: Date;
}
```

Orquestração HTTP (não desenhada em código nesta ADR, apenas o fluxo
conceitual):

```
POST /api/v1/sessions
  → AuthenticateIdentityService.execute({email, password}) → AuthenticatedIdentity
  → CreateSessionService.execute({identityPublicId}) → CreatedSession
  → seta cookie HttpOnly com CreatedSession.rawToken
  → responde 201 com { session: { publicId, expiresAt }, identity: { publicId } }
     — nunca inclui ADMIN, applicationAccesses, roles ou permissions
       (mesma restrição de AuthenticatedPrincipal, questão 8 — a
       resposta do login não vaza autorização, só identidade e sessão).
```

`password hash logic` nunca dentro do controller HTTP — inteiramente
dentro de `AuthenticateIdentityService`/`Argon2PasswordHasher`, já
implementados (ADR-029).

## Proteção contra enumeração — contrato completo

**No login (`POST /api/v1/sessions`):** todas as causas de falha
(e-mail inexistente, senha incorreta, `Credential` inexistente,
`Credential` `REVOKED`, `Identity` não `ACTIVE`, `loginEnabled=false`)
produzem a **mesma** resposta externa: `AUTHENTICATION_FAILED`, HTTP 401,
mesma mensagem genérica. Internamente (auditoria/telemetria), o motivo
real é distinguível (`authentication.failed`, payload com `reason`
interno — nunca exposto na resposta HTTP).

**Em requisições subsequentes (sessão já estabelecida):
`SESSION_INVALID` — decisão REVISTA (v0.6.x, Fase E).** A versão
original desta ADR (Fase D) previa `SESSION_NOT_FOUND`/`SESSION_EXPIRED`/
`SESSION_REVOKED` como códigos externos distintos, com o raciocínio de
que o cliente já demonstrou posse de *algum* token antes, então
distinguir a causa não vazaria existência de OUTRAS contas. Na
implementação real da Fase E, essa decisão foi revista e substituída:
mesmo sem vazar existência de outras contas, distinguir "revogada" de
"expirada" de "nunca existiu" ainda entrega um sinal comportamental a
quem possui um token roubado/copiado (ex.: "revogada" sugere que o dono
legítimo agiu — trocou de dispositivo, percebeu o roubo, fez logout;
"expirada" sugere só passagem de tempo, nenhuma ação humana). Colapsar é
estritamente mais seguro e não custa usabilidade real — a resposta
correta do cliente é sempre idêntica ("autentique novamente").

**Resolução final:** todas as causas de falha de validação de sessão —
cookie ausente, cookie vazio/malformado (incluindo cookie duplicado, ver
"Cookie duplicado" abaixo), token desconhecido, `Session` inexistente,
`Session` `REVOKED`, `Session` expirada, `Identity` inexistente,
`Identity` não `ACTIVE`, `loginEnabled=false` — produzem a MESMA resposta
externa: `SESSION_INVALID`, HTTP 401, mesma mensagem genérica. Nunca
revelar `SESSION_NOT_FOUND`/`SESSION_REVOKED`/`SESSION_EXPIRED`/
`IDENTITY_LOGIN_DISABLED` (nem qualquer variante) nesta borda HTTP.
Internamente (diagnóstico/telemetria futura), o motivo real permanece
distinguível (campo `reason` interno do erro — nunca exposto na resposta
HTTP), mesmo padrão já usado por `AUTHENTICATION_FAILED`/`reason` no
login.

## Cookie duplicado — fail closed (v0.6.x, Fase E)

Se o header `Cookie` contiver o nome canônico (`ingressa_session`) mais
de uma vez — tecnicamente inválido por HTTP, mas alguns
proxies/clientes malformados ou um ataque de "cookie injection" via
subdomínio podem produzir isso — a decisão é **fail closed**: tratar
como sessão inválida (`SESSION_INVALID`, 401), nunca escolher entre os
valores (nem o primeiro, nem o último). Motivo: escolher qualquer um dos
dois tornaria a autenticação dependente de uma precedência/ordem
ambígua de cookies — um comportamento que pode divergir entre
navegadores, proxies e a própria biblioteca de parsing, uma superfície
de ambiguidade que não deveria existir para uma decisão de segurança.
Nenhum dos dois valores é logado.

## Formato do token — decisão única (v0.6.x, Fase E)

`ValidateSessionService` **não valida o formato/comprimento do token
antes do hash** — qualquer string não vazia é normalizada (`SHA-256`) e
consultada no banco via `token_hash`. Decisão única, documentada:
validar formato (ex.: rejeitar strings que não sejam `base64url` de 43
caracteres) adicionaria uma segunda categoria de rejeição (formato
inválido vs. não encontrado) sem ganho de segurança real — um token com
formato "impossível" simplesmente não vai corresponder a nenhum
`token_hash` real no lookup, produzindo o mesmo `SESSION_INVALID` de
qualquer forma. Adicionar uma checagem de formato só criaria um segundo
caminho de código para o mesmo resultado externo, sem reduzir a
superfície de ataque (o SHA-256 de uma string maliciosa/malformada
continua computável e seguro). Único requisito mantido: string não
vazia (mesmo teste que já existe para "cookie vazio").

## Sem dummy hash — diferente do login (v0.6.x, Fase E)

Validação de sessão **não usa Argon2id/dummy hash**. Justificativa: o
token de sessão já tem 256 bits de entropia criptográfica (`crypto.
randomBytes(32)`, ADR-030 "Como o token é gerado?") — um atacante não
pode adivinhar/forçar um token válido por tentativa e erro, com ou sem
diferença de timing entre as causas de falha. A mitigação de timing do
login (dummy Argon2id) existe para proteger contra enumeração de CONTAS
via e-mail — um problema de baixa entropia (e-mails são relativamente
previsíveis/enumeráveis) que não existe aqui: o "identificador" nesta
etapa é um token de alta entropia, nunca um valor de baixo espaço de
busca. O lookup por `SHA-256` indexado é a única operação, sem custo
computacional variável — não há nada a nivelar.

## Timing attacks

**Risco real:** o tempo de resposta de "e-mail não encontrado" (falha no
passo 2 do fluxo, retorna cedo) é mensuravelmente menor que "senha
incorreta" (falha no passo 7, depois de computar um hash `Argon2id`
completo — deliberadamente caro). Um atacante medindo tempo de resposta
em massa poderia inferir quais e-mails existem, mesmo com mensagem de
erro idêntica.

**Mitigação decidida:** quando a `Identity`/`Credential` não é encontrada
(falhas nos passos 2-6), executar um **hash `Argon2id` dummy** contra uma
senha/hash fixo *antes* de retornar o erro — nivelando o tempo de
resposta ao mesmo custo computacional do caminho de verificação real
(passo 7).

**Formalização do dummy hash (revisão crítica — 4 propriedades
obrigatórias, explícitas):**

1. **Constante técnica** — um valor PHC fixo, definido uma única vez no
   código (ex.: ao lado de `ARGON2ID_PARAMS`, ADR-029), não gerado
   dinamicamente a cada chamada.
2. **Nunca corresponde a uma senha real** — não é o hash de nenhuma
   senha jamais usada por nenhuma `Identity` real; um valor
   arbitrário gerado uma vez especificamente para este propósito.
3. **Não vem do banco** — nunca uma leitura de `credentials` (nem de
   uma linha "aleatória" nem de nenhuma linha real); um literal
   embutido no código, para que o caminho "dummy" nunca dependa de uma
   consulta adicional que também poderia vazar timing.
4. **Parâmetros compatíveis com os normais** — usa os mesmos
   `ARGON2ID_PARAMS` já centralizados (ADR-029), nunca um hash mais
   barato "só para o dummy" (o que reintroduziria a mesma diferença de
   tempo que a mitigação existe para eliminar).

**Limite explícito da mitigação (não prometer mais do que ela entrega):**
isso não elimina 100% a diferença de tempo — I/O de banco (o `SELECT`
que não encontrou nada vs. os `SELECT`s adicionais do caminho completo)
ainda varia, e a rede/scheduler do processo introduzem ruído que nenhuma
mitigação de aplicação elimina totalmente. O que a mitigação remove é a
diferença **dominante**: o custo do `Argon2id`, que é ordens de magnitude
maior que qualquer consulta indexada — reduzindo o sinal disponível para
um atacante a um nível que exigiria uma quantidade impraticável de
amostras para ser estatisticamente confiável, não a zero.

## CSRF

Sessão via cookie `HttpOnly` exige proteção CSRF (diferente de `Bearer`,
que é imune a CSRF por natureza — o navegador não anexa headers
automaticamente).

**`SameSite=Lax` não é proteção absoluta** — revisão crítica: a primeira
versão desta ADR tratava `SameSite=Lax` como suficiente por si só, com
tudo o mais deferido. Corrigido: `SameSite=Lax` mitiga a maioria dos
cenários de CSRF cross-site em navegadores modernos e compatíveis, mas
não cobre navegadores desatualizados/não compatíveis, nem substitui
validação server-side. Uma segunda camada, mínima e **fazendo parte do
desenho fechado desta fase** (não mais deferida por completo), é
necessária.

**Política mínima fechada para esta fase, para todo endpoint mutável
autenticado por cookie** (`POST`/`PUT`/`PATCH`/`DELETE`, ex.: `POST
/api/v1/sessions`... exceto o próprio login, que ainda não tem sessão
para validar contra — a validação de `Origin` se aplica a partir do
`DELETE /api/v1/sessions/current`/logout e a qualquer endpoint mutável
futuro que exija sessão já estabelecida):

1. **Validar `Origin`** quando o header estiver presente — deve
   corresponder à origem esperada da aplicação (lista de origens
   permitidas, configurável via ambiente, nunca hardcoded). Requisição
   rejeitada (403) se `Origin` presente e não corresponder.
2. **`Referer` como fallback** apenas quando `Origin` estiver ausente
   (alguns navegadores/proxies omitem `Origin` em certas condições
   legítimas) — mesma checagem de correspondência de origem.
3. **Rejeitar claramente cross-site inválido**: se nem `Origin` nem
   `Referer` estiverem presentes em uma requisição mutável autenticada
   por cookie, tratar como suspeito e rejeitar (não assumir "ausência é
   segura" silenciosamente).

**Token CSRF dedicado (`double-submit cookie` ou equivalente com estado
server-side): avaliado, permanece deferido** — dívida de segurança
registrada explicitamente, não esquecida. A validação de
`Origin`/`Referer` acima é a defesa mínima desta fase, não a defesa
final; um token dedicado é a evolução natural quando o frontend web real
existir e o fluxo de uso puder ser avaliado contra ele.

**Nada disso é implementado nesta ADR** — é a política que a
implementação futura da Fase D deve seguir como piso mínimo, não uma
sugestão opcional.

## `POST /api/v1/sessions` — 201, decisão fechada

**Decisão: `201 Created`.** `POST /api/v1/sessions` cria um recurso
`Session` server-side com identidade própria (`publicId`) e efeito
colateral persistente (linha em `sessions`, evento `session.created`) —
semântica REST padrão para criação de recurso é `201`, não `200` (que
seria mais apropriado para uma operação que não cria um recurso
endereçável, como uma consulta ou uma ação sem estado novo). `Location`
pode apontar conceitualmente para `/api/v1/sessions/{publicId}` — mesmo
que um `GET` individual desse recurso ainda não exista nesta fase (o
header `Location` é válido independentemente de o endpoint `GET`
correspondente já estar implementado; é uma indicação semântica do
recurso criado, não uma promessa de que ele é imediatamente navegável).

## Cookie — parâmetros

| Parâmetro | Valor | Justificativa |
|---|---|---|
| `HttpOnly` | `true` | JavaScript nunca lê o cookie — mitiga roubo via XSS. |
| `Secure` | `true` | Nunca trafega em HTTP puro — obrigatório mesmo em DEV com HTTPS (ou desabilitado explicitamente só em `NODE_ENV=development` local, se necessário — decisão de implementação). |
| `SameSite` | `Lax` | Ver CSRF acima. |
| `Path` | `/` | Escopo simples nesta fase — sem necessidade de restringir a um sub-path. |
| `Max-Age`/`Expires` | Igual a `Session.expiresAt` | Cookie não deve sobreviver além da sessão server-side. |
| Nome do cookie | Centralizado em uma constante (ex.: `SESSION_COOKIE_NAME`) | Nunca string mágica espalhada pelo código — mesmo princípio já aplicado a `LOCAL_PASSWORD`/`ACTIVE` em ADR-029. |
| Domínio | **Não hardcoded** — lido de configuração/env, nunca fixado em código para um domínio de produção específico | Task, seção 17, explícito. |

## Eventos

**Novos, a formalizar quando implementados** (nomes já reservados em
`CATALOGO-DE-EVENTOS.md` para `session.created`/`session.revoked` —
reutilizados sem alteração de payload):

- `session.created` — payload já catalogado: `session_id`, `identity_id`,
  `created_at`, `expires_at`. Confirmado: nunca publica o token.
- `session.revoked` — payload já catalogado: `session_id`, `identity_id`,
  `revoked_at`, `reason_code`.

**Novos, não catalogados ainda — a formalizar quando implementados:**

- `authentication.succeeded` — `Domain Event` genuíno (identidade provada
  é um fato de negócio) ou **log operacional**? **Decisão: log
  operacional/`AuditEvent`, não `Domain Event`** — autenticação bem
  sucedida não muda estado de nenhum agregado por si só (a mudança de
  estado real é a criação da `Session`, já coberta por `session.created`).
  Registrar como `AuditEvent` avulso (sem `Domain Event` correspondente)
  é suficiente e evita duplicar semântica com `session.created`.
- `authentication.failed` — **log operacional/telemetria**, não
  `Domain Event` nem necessariamente um `AuditEvent` formal (`AuditEvent`
  hoje é usado para mudanças de estado de agregados; uma tentativa
  falha não muda estado nenhum). Cuidado explícito de payload: **nunca**
  incluir a senha, nunca o e-mail em texto claro se a política de
  retenção de log for mais ampla que a de `AuditEvent` (avaliar
  mascaramento — mesma cautela já aplicada a e-mails mascarados nos CLIs
  de bootstrap). Puramente para detecção de brute-force/auditoria de
  segurança, não para reconstrução de estado de negócio.

**Garantia formal, válida para TODOS os eventos desta ADR (`session.created`,
`session.revoked`, `authentication.succeeded`, `authentication.failed`,
sem exceção — revisão crítica, item 14):** nenhum evento pode conter, em
nenhuma forma, direta ou derivada:

- `password` (a senha em texto puro, em qualquer campo).
- `password_hash`/PHC (o hash da senha).
- Token bruto de sessão (só `session_id`/`publicId` pode aparecer —
  nunca o valor que vai no cookie).
- O valor do cookie em si.
- O header `Authorization` (nem seu valor, nem sua presença/ausência
  registrada de forma que permita inferir o token).

## Contrato de erro

| Código | HTTP | Contexto | Observação |
|---|---|---|---|
| `AUTHENTICATION_FAILED` | 401 (classificação `AUTHENTICATION`, ver "Conflitos") | Login (`POST /sessions`) | Único código externo para qualquer causa de falha de login — ver "Proteção contra enumeração". Tentativa de CRIAR uma sessão nova falhou. |
| `SESSION_INVALID` | 401 | Validação de uma sessão já existente (`GET /me`, `DELETE /sessions/current`, middleware) — **v0.6.x, Fase E, decisão revista** | Único código externo para toda causa de falha de validação — ver "Proteção contra enumeração" abaixo, revisão explícita da decisão original desta ADR. Credencial de sessão apresentada não autentica mais a requisição. |

**`AUTHENTICATION_FAILED` × `SESSION_INVALID` — diferença formal:**
`AUTHENTICATION_FAILED` responde a uma tentativa de criar uma sessão
nova que falhou (`POST /api/v1/sessions`) — não havia sessão alguma
ainda. `SESSION_INVALID` responde a uma sessão *já existente* (via
cookie) que não autentica mais a requisição atual, por qualquer motivo
(`GET /api/v1/me`, `DELETE /sessions/current`, ou qualquer middleware de
autenticação futuro). Ambos pertencem exclusivamente a `AUTHENTICATION`
(401) — nunca `AUTHORIZATION` (403); a diferença entre eles é de
*contexto* (criar vs. validar uma sessão), não de classificação.

`500` sempre sanitizado (mesmo padrão já em `createApp.ts`: `{code:
"INTERNAL_ERROR", message: "Erro interno inesperado.", correlation_id,
details: []}` — nunca stack trace, nunca detalhe de driver). `correlation_id`
sempre preservado no envelope de erro, mesmo padrão já existente.

`INVALID_CREDENTIALS`/`IDENTITY_LOGIN_DISABLED`/`IDENTITY_BLOCKED` (v0.2.0,
`API-CONTRACT-V1.md`) — **descontinuados como códigos externos
distintos**, substituídos por `AUTHENTICATION_FAILED` único (ver
"Conflitos reais encontrados").

## Persistência conceitual (`sessions`, não migrada nesta ADR)

```
sessions
  id                 BIGINT UNSIGNED AUTO_INCREMENT PK  (interno)
  public_id          CHAR(36) UNIQUE NOT NULL
  identity_public_id CHAR(36) NOT NULL  -- FK identities.public_id, ON DELETE RESTRICT ON UPDATE RESTRICT
  token_hash         CHAR(64) NOT NULL UNIQUE  -- SHA-256 em hex, 64 caracteres — nunca o token bruto
  status             ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE'  -- EXPIRED e derivado, nunca persistido
  created_at         DATETIME(3) NOT NULL
  expires_at         DATETIME(3) NOT NULL
  last_seen_at       DATETIME(3) NULL
  revoked_at         DATETIME(3) NULL
  revocation_reason  VARCHAR(64) NULL  -- enum fechado quando implementado
  version            BIGINT UNSIGNED NOT NULL DEFAULT 1

  UNIQUE KEY uk_sessions_public_id (public_id)
  UNIQUE KEY uk_sessions_token_hash (token_hash)
  KEY idx_sessions_identity_status (identity_public_id, status)
  KEY idx_sessions_expires_at (expires_at)
  FOREIGN KEY (identity_public_id) REFERENCES identities (public_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
```

`ip`/`user_agent`: **avaliados e deixados fora desta fase** (task, seção
25). Justificativa: `MODELO-DE-DOMINIO.md` já registrava isso como
"Pendente de decisão sobre retenção e anonimização" — não resolvido
agora, porque envolve considerações de LGPD (dado pessoal, minimização,
finalidade, prazo de retenção) que merecem decisão própria, não uma
adição incidental "porque é comum". Se adicionados no futuro, seriam
colunas opcionais na mesma tabela, aditivas.

**Nenhuma migration criada nesta entrega.**

## `last_authenticated_at` — quando atualizar

**Apenas em autenticação bem-sucedida** (task, seção 23, confirmado) —
nunca em tentativa falha (uma tentativa falha não prova que o dono
legítimo tentou logar; atualizar aqui poderia mascarar tentativas de
força bruta bem-sucedidas de adivinhação parcial).

**Não-gatilhos, formalizados explicitamente (revisão crítica — os três
casos que NÃO atualizam este campo):**

1. **Falha de senha** — `Argon2id.verify()` retorna falso: não atualiza.
2. **Sessão existente sendo apenas validada** (ex.: uma requisição
   futura que confirma que o cookie ainda é válido) — não é uma nova
   autenticação por senha, não atualiza. `last_authenticated_at`
   representa especificamente "a última vez que a senha foi verificada
   com sucesso", não "a última vez que a sessão foi usada" (esse
   segundo conceito é `Session.lastSeenAt`, campo diferente, na entidade
   diferente).
3. **Refresh futuro** (quando `RefreshToken` existir) — renovar uma
   sessão via refresh token não envolve verificar a senha novamente; não
   deve atualizar `last_authenticated_at`, precisamente porque não houve
   nova prova de senha.

Persistido na mesma transação de `CreateSessionService` (não em uma
transação separada) — evita uma janela onde a sessão existe mas
`last_authenticated_at` não foi atualizado, ou vice-versa. Requer
optimistic locking (`Credential.version`, já existente, ADR-024) — mesma
mecânica já usada para `Identity`.

## Invalidação de sessão — `loginEnabled=false` / Identity bloqueada / Credential revogada — regra arquitetural (não implementada)

Task, seção 22/revisão crítica seção 10 — regras definidas agora,
implementação adiada. Todos os três casos abaixo **devem** invalidar a
capacidade de uma sessão continuar sendo aceita:

- **A) `loginEnabled=false` → sessões existentes deixam de ser
  válidas.** Justificativa: um administrador desabilitando login para
  uma Identity espera efeito imediato, não "na próxima expiração".
- **B) `Identity` `BLOCKED`/`SUSPENDED`/`DELETED` → sessões existentes
  deixam de ser válidas.** Mesma urgência de A.
- **C) `Credential` `REVOKED`/trocada → sessões existentes daquela
  `Identity` devem ser revogadas.** Justificativa: se a senha foi
  comprometida e por isso trocada, sessões existentes (potencialmente
  também comprometidas, ou simplesmente obsoletas) não devem sobreviver.

**Distinção explícita entre os três mecanismos que, juntos, implementam
essa invalidação (revisão crítica — não deixar isso implícito):**

1. **Revogação imediata persistida** (`UPDATE sessions SET
   status='REVOKED', revocation_reason=?` para todas as sessões
   `ACTIVE` da `Identity` afetada) — o mecanismo *definitivo*, disparado
   no momento em que A/B/C acontece. É o que realmente torna a sessão
   inválida de forma duradoura e auditável (`session.revoked` é emitido
   para cada sessão revogada em massa).
2. **Validação defensiva a cada requisição** — mesmo com a revogação em
   massa (item 1) implementada corretamente, todo middleware de sessão
   futuro **deve, adicionalmente**, checar em tempo real
   `Identity.status = 'ACTIVE'` e `Identity.loginEnabled = true` (não só
   `Session.status = 'ACTIVE'`) antes de aceitar uma sessão como válida —
   defesa em profundidade contra qualquer janela entre a mudança de
   estado de `Identity`/`Credential` e a revogação em massa ainda não
   ter sido processada (ex.: se a revogação em massa for implementada de
   forma assíncrona/eventual no futuro, em vez de síncrona na mesma
   transação). Nesta fase (Fase D, primeiro login), essa validação
   defensiva já é parte do fluxo de login em si (`AuthenticateIdentityService`
   já checa `status`/`loginEnabled` a cada tentativa) — o ponto em aberto
   é estendê-la para a validação de sessões *já emitidas* em requisições
   subsequentes, quando esse middleware existir.
3. **Evento que dispara a revogação em massa** — o gatilho: quando um
   comando administrativo futuro (`RevokeCredential`, `BlockIdentity`,
   `DisableLogin`, nenhum implementado ainda) muda o estado relevante,
   ele deve, na mesma transação, também emitir a revogação em massa
   (item 1) — não um job assíncrono separado que rode "eventualmente".
   Isso garante que não existe uma sessão "zumbi" válida entre a mudança
   de estado e sua revogação.

**Comportamento alvo, resumido:** a fonte de verdade imediata é a
revogação persistida (1), reforçada por validação defensiva (2) como
segunda camada de segurança, ambas disparadas pelo mesmo evento de
mudança de estado (3) — nunca dependendo de só uma das três camadas
isoladamente.

Nenhuma dessas regras está implementada nesta entrega — ficam
registradas como requisito arquitetural para quando os comandos
administrativos correspondentes existirem. A tabela `sessions` desenhada
acima já suporta isso sem alteração de schema.

## `RefreshToken` — status explícito (revisão crítica, item 15)

Cinco pontos, formalizados explicitamente para não deixar ambíguo:

1. **`RefreshToken` permanece válido como direção arquitetural** — o
   modelo conceitual já documentado em `MODELO-DE-DOMINIO.md`, seção 12
   (com rotação, detecção de reuso, etc.) continua sendo a direção
   correta para quando essa capacidade for necessária.
2. **NÃO entra na primeira implementação da Fase D.** A implementação
   real desta fase (quando ocorrer) não inclui `RefreshToken` de forma
   alguma — nem tabela, nem código, nem endpoint.
3. **Não remover do modelo** — `MODELO-DE-DOMINIO.md`, seção 12,
   permanece como está, sem edição nesta ADR. Este documento não
   descarta `RefreshToken`; apenas posterga sua implementação.
4. **A primeira sessão funciona apenas com token de sessão opaco +
   expiração absoluta** — sem qualquer mecanismo de renovação. Quando a
   sessão expira, o usuário precisa autenticar novamente com e-mail e
   senha; não há renovação silenciosa nesta fase.
5. **Refresh/rotação entram em uma fatia posterior**, explicitamente
   fora do escopo desta ADR e da sua primeira implementação — sem data
   ou fatia específica comprometida aqui.

## Rate limiting — avaliado, não implementado, com requisito mínimo definido

**Avaliação (task, seção 28):**

| Estratégia | Prós | Contras |
|---|---|---|
| Por IP | Simples, não depende de saber se o e-mail existe | Ineficaz contra distribuição (botnets); pode penalizar múltiplos usuários atrás do mesmo NAT/proxy corporativo |
| Por identificador normalizado (e-mail) | Protege uma conta específica de brute-force direcionado | Precisa existir *antes* de saber se a conta existe — não pode consultar `Credential` primeiro sem reintroduzir enumeração por timing |
| Lockout de `Credential` (campo `failedAttempts`/`lockedUntil`) | Protege a conta mesmo com IPs variados | Já avaliado e **deferido** em ADR-029 ("Lockout") — mesma decisão se aplica aqui |
| Combinação (IP + identificador) | Mais robusto | Mais complexidade de implementação e de infraestrutura (contador distribuído) |

**Decisão: não implementado nesta fase, mas com requisito mínimo já
definido para a implementação futura — não uma lacuna muda (revisão
crítica: "não deixar apenas como 'futuro'").** Quando implementado, a
futura camada de rate limiting de `POST /api/v1/sessions` DEVE:

1. **Combinar limite por IP e por identificador normalizado
   (e-mail)** — nunca só um dos dois isoladamente (por IP sozinho é
   ineficaz contra distribuição; por identificador sozinho é ineficaz
   contra um único atacante variando e-mails). O limite por identificador
   é aplicado *depois* de normalizar o e-mail recebido, sem depender de
   saber se a conta existe (o contador é incrementado pela tentativa em
   si, não por uma consulta prévia ao banco — evita reintroduzir
   enumeração por timing).
2. **Janela e limiar configuráveis por ambiente**, nunca hardcoded no
   código (ex.: N tentativas por M minutos, valores lidos de
   configuração).
3. **Resposta genérica ao exceder o limite** — mesmo formato de erro já
   usado em qualquer outra falha (nunca uma mensagem como "muitas
   tentativas para este e-mail", que confirmaria a existência da conta;
   a mensagem de limite excedido deve ser igualmente genérica, com um
   código de erro próprio, ex.: `TOO_MANY_REQUESTS`/429, sem mencionar o
   identificador).
4. **Nunca revelar existência de conta** através do comportamento de
   rate limiting em si — se o limite por identificador e o limite por IP
   tiverem respostas ou tempos de bloqueio observavelmente diferentes,
   isso também seria um canal de enumeração; a resposta externa deve ser
   idêntica não importa qual dos dois limites foi excedido.

Lockout persistente de `Credential` (`failedAttempts`/`lockedUntil`)
continua **deferido** (mesma decisão de ADR-029) — o rate limiting acima
é a proteção contra brute force desta fase; lockout por credencial é uma
camada adicional futura, não uma dependência para o rate limiting
funcionar.

Infraestrutura: depende de um contador que a stack atual não tem (sem
Redis, decisão da v0.4.0) — um contador só-em-banco é possível e atende
ao requisito mínimo acima, mas tem trade-offs de contenção sob alta
concorrência que merecem desenho próprio na implementação (não
resolvidos aqui, propositalmente — são decisão de implementação, não de
arquitetura).

## Nginx — nota de deploy futuro

`ingressa-dev.pctec.com.br` hoje só expõe `/health` (ADR-026). Quando
`POST /api/v1/sessions` for implementado, será necessária mudança
explícita do reverse proxy para expor a nova rota — **não incluída nesta
ADR nem alterada agora**, registrada como etapa futura de deploy
(dependência entre entregas, não uma decisão arquitetural desta ADR).

## O que fica para implementação futura (task, seção 31/18)

- `Credential` lookup por e-mail/Identity (código real).
- `Argon2id.verify()` real (biblioteca já instalada e testada, ADR-029 —
  só falta o uso no fluxo de login).
- `AuthenticateIdentityService`, `CreateSessionService` (código real).
- `Session`/`SessionRepository`, migration `sessions`.
- `POST /api/v1/sessions`, cookie real, `DELETE /api/v1/sessions/current`
  (logout).
- Middleware de validação de sessão para rotas autenticadas futuras.
- Extensão de `DomainErrorClassification` com `"AUTHENTICATION"` → 401.
- Correção formal de `API-CONTRACT-V1.md` (remover
  `IDENTITY_LOGIN_DISABLED`/`IDENTITY_BLOCKED`/`INVALID_CREDENTIALS` como
  códigos externos distintos).
- `RefreshToken` com rotação (já modelado, `MODELO-DE-DOMINIO.md` seção
  12) — explicitamente fora desta fase.
- Rate limiting (roadmap acima, não escolhido definitivamente).
- CSRF token dedicado / validação de `Origin`/`Referer` (deferido, ver
  seção CSRF).
- `ip`/`user_agent` em `Session` (deferido, questão de LGPD a decidir
  separadamente).
- Regras de revogação de sessão por troca de `Credential`/
  `loginEnabled=false`/bloqueio de `Identity` (regra definida acima, sem
  código ainda — depende de comandos que também não existem ainda).
- Mudança de Nginx para expor a nova rota.

## Status

Documental — v0.6.0, Fase D da ADR-027. Nenhum código implementado. Não
executado nada contra o MariaDB DEV. Aprovação pendente do Product Owner
e do Platform Architect.
