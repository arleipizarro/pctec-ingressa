import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * Recusas da confirmação de um cliente escolhido no catálogo.
 *
 * Todas com código estável, e **nenhuma delas cita** SQL, host, usuário
 * de banco, senha ou documento integral. Um erro é o caminho mais fácil
 * para um dado sair do sistema sem ninguém decidir que ele podia sair —
 * e estas mensagens vão para a tela de quem opera.
 *
 * O `legacyId` aparece nas mensagens de propósito: ele é o número que a
 * própria pessoa acabou de selecionar na tela, não um segredo, e sem
 * ele a mensagem não diria QUAL cliente foi recusado.
 */
export class PortalCatalogLegacyIdInvalidError extends DomainError {
  public readonly code = "PORTAL_CATALOG_LEGACY_ID_INVALID";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super("Selecione um cliente do Portal — o identificador enviado não é um inteiro positivo.");
  }
}

/**
 * O cliente não existe mais na fonte.
 *
 * Não é o mesmo que "a busca não achou": aqui a pessoa VIU o cliente na
 * lista e ele sumiu entre a busca e a confirmação. 404 pelo mesmo
 * padrão de `PORTAL_REFERENCE_ORGANIZATION_NOT_FOUND` — recurso
 * inexistente, não falta de autorização.
 */
export class PortalCatalogClientNotFoundError extends DomainError {
  public readonly code = "PORTAL_CATALOG_CLIENT_NOT_FOUND";
  public readonly classification = "VALIDATION" as const;

  constructor(legacyId: number) {
    super(
      `O cliente ${legacyId} não existe mais no Portal. Busque de novo e selecione um cliente atual.`
    );
  }
}

/**
 * O cliente existe e está **inativo**.
 *
 * Recusa separada de "não existe" porque a ação é outra: reativar o
 * cadastro no Portal, e não escolher outro cliente. E é 409 e não 422
 * porque nada no pedido está malformado — o que mudou foi o estado do
 * mundo entre a busca e a confirmação.
 */
export class PortalCatalogClientInactiveError extends DomainError {
  public readonly code = "PORTAL_CATALOG_CLIENT_INACTIVE";
  public readonly classification = "CONFLICT" as const;

  constructor(legacyId: number) {
    super(
      `O cliente ${legacyId} está inativo no Portal e não pode receber vínculo. ` +
        "Reative o cadastro no Portal antes de vincular."
    );
  }
}
