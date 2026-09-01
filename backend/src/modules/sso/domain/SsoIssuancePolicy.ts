import { SsoAuthorizationDeniedError } from "./errors/SsoErrors.js";

/**
 * O que o serviço genérico de emissão sabe sobre o pedido quando
 * consulta as políticas do cliente. Nada além disto: quem é a Identity
 * (já autenticada), para qual aplicação, e a correlação da requisição.
 *
 * Nunca carrega sessão, cookie, `redirect_uri`, `code_challenge` ou
 * qualquer material do fluxo — uma política de produto não tem o que
 * fazer com isso, e não recebê-lo é o que impede que ela vire um
 * segundo lugar onde o SSO é implementado.
 */
export interface SsoIssuanceContext {
  readonly identityPublicId: string;
  readonly applicationCode: string;
  readonly correlationId: string;
}

/**
 * Exigência ADICIONAL de um produto específico para que uma sessão nele
 * faça sentido — avaliada DEPOIS das invariantes de segurança do SSO
 * (Identity ACTIVE, `login_enabled`, Application ACTIVE,
 * `ApplicationAccess` GRANTED, perfil suficiente), nunca no lugar delas.
 *
 * **Por que este port existe.** Até a fundação do Meu RH, a exigência de
 * contexto organizacional do Portal ("nenhuma Organization utilizável →
 * recusa") vivia dentro de `IssueAuthorizationCodeService`, o serviço
 * que atende TODOS os clientes SSO. A consequência era silenciosa e
 * grave: qualquer produto novo herdava, sem decidir, uma regra que é do
 * Portal. Um produto de RH, em que a pessoa é funcionária e não
 * representante de cliente, seria recusado por não ter Membership —
 * ainda que o Ingressa já soubesse que ela pode entrar.
 *
 * A pergunta do SSO é "esta Identity pode entrar nesta Application?".
 * A pergunta "esta sessão será útil quando ela entrar?" é do produto, e
 * por isso é ele quem a declara, aqui.
 *
 * **Contrato:** `evaluate` resolve em silêncio quando aprova, e lança
 * `SsoAuthorizationDeniedError` quando recusa — nunca devolve booleano.
 * Um `false` esquecido por um chamador vira acesso concedido; uma
 * exceção não tem como ser ignorada por omissão. Qualquer outro erro
 * (banco indisponível, por exemplo) propaga como está e a emissão falha
 * fechada, que é o comportamento correto quando não se consegue provar
 * a condição.
 */
export interface SsoIssuancePolicy {
  /** Nome estável, só para diagnóstico/auditoria — nunca decide nada. */
  readonly name: string;
  evaluate(context: SsoIssuanceContext): Promise<void>;
}

/**
 * Políticas de emissão declaradas POR CLIENTE SSO.
 *
 * A declaração é obrigatória e explícita: registrar um cliente sem
 * dizer quais políticas ele exige é recusado na construção, com erro de
 * boot. Uma lista vazia é uma resposta perfeitamente válida — é como
 * um produto diz "as invariantes do SSO me bastam" — mas precisa ser
 * ESCRITA. A alternativa (ausência = nenhuma política) transformaria
 * esquecimento em afrouxamento de segurança, que é exatamente a classe
 * de erro que a separação do gate existe para evitar.
 *
 * Não há `if (applicationCode === "...")` em lugar nenhum do módulo SSO:
 * o serviço genérico pergunta ao registro, e o registro responde com o
 * que a composição declarou. Quem conhece o Portal é a composição, não o
 * SSO.
 */
export class SsoIssuancePolicyRegistry {
  private readonly policiesByApplicationCode: ReadonlyMap<string, readonly SsoIssuancePolicy[]>;

  public constructor(declarations: Readonly<Record<string, readonly SsoIssuancePolicy[]>>) {
    this.policiesByApplicationCode = new Map(
      Object.entries(declarations).map(([applicationCode, policies]) => [applicationCode, [...policies]])
    );
  }

  public isDeclaredFor(applicationCode: string): boolean {
    return this.policiesByApplicationCode.has(applicationCode);
  }

  /**
   * Políticas de um cliente JÁ registrado.
   *
   * Um `applicationCode` sem declaração é um erro de composição, não um
   * caso de uso: significa que alguém registrou um cliente SSO e não
   * decidiu o que ele exige. Recusar aqui (fail-closed) evita que essa
   * omissão apareça como "produto sem nenhuma exigência".
   */
  public requireFor(applicationCode: string): readonly SsoIssuancePolicy[] {
    const policies = this.policiesByApplicationCode.get(applicationCode);
    if (policies === undefined) {
      throw new SsoAuthorizationDeniedError("ISSUANCE_POLICY_NOT_DECLARED");
    }
    return policies;
  }
}
