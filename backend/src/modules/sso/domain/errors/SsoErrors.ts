import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Requisição de autorização malformada ou apontando para um cliente/
 * redirect_uri não registrado — 400/422, NUNCA um redirect.
 *
 * A distinção é deliberada e é a defesa contra open redirect: enquanto o
 * par (client_id, redirect_uri) não estiver comprovadamente registrado,
 * o Ingressa não devolve o navegador para lugar nenhum. Só depois dessa
 * prova é que erros posteriores podem, em tese, voltar ao cliente — e
 * mesmo assim esta implementação prefere manter a pessoa no Ingressa
 * (ver `ssoAuthorizeRoutes.ts`).
 *
 * `reason` é interno (diagnóstico/log); a mensagem externa é sempre a
 * mesma frase genérica, para não ensinar a um chamador hostil qual dos
 * parâmetros ele acertou.
 */
export class SsoAuthorizationRequestInvalidError extends DomainError {
  public readonly code = "SSO_AUTHORIZATION_REQUEST_INVALID";
  public readonly classification = "VALIDATION" as const;

  public constructor(public readonly reason: string) {
    super("Requisição de autorização inválida.");
  }
}

/**
 * A Identity está autenticada, mas não pode iniciar SSO para esta
 * aplicação — 403.
 *
 * Todas as causas colapsam externamente na mesma resposta (mesma
 * decisão já tomada em `ApplicationAccessDeniedError` e
 * `SessionValidationFailedError`): Identity não ACTIVE, login desabilitado,
 * Application inativa, acesso não concedido, nenhum vínculo empresarial
 * utilizável. `reason` existe só internamente.
 */
export class SsoAuthorizationDeniedError extends DomainError {
  public readonly code = "SSO_AUTHORIZATION_DENIED";
  public readonly classification = "AUTHORIZATION" as const;

  public constructor(public readonly reason: string) {
    super("Acesso negado a esta aplicação.");
  }
}

/**
 * A troca do código falhou — 400 para o backend do Portal.
 *
 * Colapsa TODAS as causas: código inexistente, já consumido (replay),
 * expirado, `redirect_uri` diferente do da emissão, `client_id`
 * diferente do audience, `code_verifier` que não satisfaz o desafio.
 * Distinguir replay de expiração diria a um atacante que o código
 * existiu, e distinguir redirect_uri de PKCE diria qual metade ele
 * acertou.
 */
export class SsoAuthorizationCodeExchangeFailedError extends DomainError {
  public readonly code = "SSO_CODE_EXCHANGE_FAILED";
  public readonly classification = "AUTHENTICATION" as const;

  public constructor(public readonly reason: string) {
    super("Código de autorização inválido, expirado ou já utilizado.");
  }
}
