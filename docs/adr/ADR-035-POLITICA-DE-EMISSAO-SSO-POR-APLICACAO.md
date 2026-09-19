# ADR-035 — Exigência de contexto organizacional é política do produto, não do SSO

## Contexto

`IssueAuthorizationCodeService` é o serviço que emite o código de
autorização para **todos** os clientes SSO. Até esta decisão, ele fazia,
além das invariantes de segurança do SSO, mais uma checagem:

```ts
const context = await this.getPortalContextService.execute(identityPublicId);
if (context.organizations.length === 0) {
  throw new SsoAuthorizationDeniedError("NO_USABLE_MEMBERSHIP");
}
```

A regra é legítima e continua valendo: uma sessão criada no Portal sem
nenhuma organização acessível não é uma sessão útil — é uma tela vazia
com um cookie válido, e recusar na emissão devolve a pessoa ao launcher
com uma negativa clara em vez de empurrá-la para um produto onde nada
abre.

O problema é **onde** ela morava. Estando no serviço genérico, valia
para qualquer cliente SSO presente ou futuro, sem que ninguém tivesse
decidido isso. O PCTEC Meu RH torna a consequência concreta: ali a pessoa
é funcionária, não representante de um cliente. Ela não tem — nem deve
ter — Membership em Organization nenhuma. Seria recusada por não
satisfazer uma regra do Portal, mesmo o Ingressa já sabendo que ela pode
entrar.

O SSO responde a uma pergunta:

> Esta Identity pode entrar nesta Application?

"Esta sessão será útil quando ela entrar?" é outra pergunta, e é do
produto.

## Decisão

### 1. O serviço genérico volta a responder só o que é dele

`IssueAuthorizationCodeService` verifica: Identity `ACTIVE`,
`login_enabled`, Application `ACTIVE`, `ApplicationAccess` `GRANTED` e
perfil suficiente. Nada mais. O módulo `sso` deixou de importar
`GetPortalContextService` e não conhece `Membership`, `Organization` nem
a expansão de grupo.

### 2. Port `SsoIssuancePolicy`, declarado pelo produto

```ts
interface SsoIssuancePolicy {
  readonly name: string;
  evaluate(context: SsoIssuanceContext): Promise<void>; // lança para recusar
}
```

O contexto entregue à política é deliberadamente mínimo —
`identityPublicId`, `applicationCode`, `correlationId`. Nunca sessão,
cookie, `redirect_uri` ou `code_challenge`: uma política de produto não
tem o que fazer com material do fluxo, e não recebê-lo é o que impede
que ela vire um segundo lugar onde o SSO é implementado.

`evaluate` **lança** para recusar, em vez de devolver booleano. Um
`false` esquecido por um chamador vira acesso concedido; uma exceção não
tem como ser ignorada por omissão. Qualquer outro erro (banco
indisponível) propaga e a emissão falha fechada, que é o comportamento
correto quando não se consegue provar a condição.

### 3. O Portal declara a sua

`RequirePortalOrganizationContextPolicy` vive no módulo `portal` e
delega ao **mesmo** `GetPortalContextService` de sempre — nada foi
reimplementado. O motivo interno da recusa continua sendo
`NO_USABLE_MEMBERSHIP`, na mesma etapa do fluxo, com a mesma resposta
externa genérica. **O comportamento efetivo do Portal não mudou.**

### 4. Declaração obrigatória, e ausência é recusa

`SsoIssuancePolicyRegistry` é construído em par com o registro de
clientes, no mesmo bloco de `composeSso`. Um `applicationCode` sem
declaração não é tratado como "produto sem exigências": é recusado
(`ISSUANCE_POLICY_NOT_DECLARED`).

Lista vazia é resposta perfeitamente válida — é como um produto diz "as
invariantes do SSO me bastam" — mas precisa ser **escrita**. A
alternativa (ausência = nenhuma política) transformaria esquecimento em
afrouxamento de segurança, que é exatamente a classe de erro que esta
separação existe para evitar.

### 5. Sem `if` sobre código de aplicação

Não existe, em nenhum ponto do módulo `sso`, um `if (applicationCode ===
"…")`. O serviço pergunta ao registro; o registro responde com o que a
composição declarou. Quem conhece o Portal é a composição
(`createApp.ts`), que já é o lugar onde os dois módulos se encontram —
nunca o SSO.

Em particular, **não** foi introduzido nenhum
`if (application === "PCTEC_MEU_RH")`: o Meu RH não aparece em lugar
nenhum desta decisão, e a abstração foi provada com uma aplicação
sintética, sem registrar nada no catálogo.

## Consequências

- O construtor de `IssueAuthorizationCodeService` mudou: onde recebia
  `GetPortalContextService`, recebe `SsoIssuancePolicyRegistry`. Os
  testes de caracterização tiveram **apenas a linha de construção**
  alterada; todas as asserções permaneceram idênticas — é isso que prova
  que a mudança foi refatoração, e não mudança de política.
- Um produto futuro que precise de contexto organizacional declara a
  política do Portal (ou a sua própria) — a regra virou reutilizável em
  vez de universal por acidente.
- Um cliente SSO registrado sem declaração de política para de
  funcionar, em vez de funcionar sem exigência nenhuma. É a direção
  segura de falhar.

## Status

Aceito na fundação do PCTEC Meu RH.

Relacionadas: ADR-028 (`ApplicationAccess`), ADR-031 (Organization
canônica), ADR-032 (`AccessProfile USER`), ADR-033 (binding Identity ↔
sujeito externo).
