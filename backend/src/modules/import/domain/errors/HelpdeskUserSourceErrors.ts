import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * A fonte de USUÁRIOS do Helpdesk não está disponível.
 *
 * ## Por que isto existe
 *
 * O Helpdesk moveu o registro de EMPRESAS para `pctecdb.clientes` — e
 * essa parte está concluída: o próprio Helpdesk lê de lá
 * (`routes/clients.js`, pool `pctecdb`). O registro de USUÁRIOS **não**
 * foi movido. O código vivo do Helpdesk continua tratando
 * `pctec_helpdesk.users` como autoridade: é lá que a autenticação
 * procura (`routes/auth.js`), e é lá que `role`, `client_id` e `active`
 * são gravados (`routes/users.js`). Essa tabela não existe mais no
 * servidor.
 *
 * `helpdesk_usuarios` **não** é a substituta. Ela é escrita uma única
 * vez, num `INSERT IGNORE` que grava apenas `(usuario_id, role,
 * active)`, nunca recebe `client_id`, e **nenhum `SELECT` do Helpdesk a
 * consulta**. Adotá-la aqui inventaria uma autoridade que o sistema de
 * origem não reconhece — e o vínculo usuário↔empresa, que é o único
 * que autoriza a importação, simplesmente não está lá.
 *
 * ## Por que é uma RECUSA, e nunca uma lista vazia
 *
 * Esta é a distinção que o erro existe para proteger. "Não consegui
 * perguntar" e "perguntei e não há ninguém" levam a ações opostas:
 * a segunda convida o ADMIN a concluir a importação sem usuários, ou a
 * cadastrá-los de novo à mão — decisões tomadas sobre uma informação
 * que ninguém verificou. Devolver `[]`, `NOT_FOUND` ou um lote
 * COMPLETED sem usuários seria afirmar um fato sobre a origem a partir
 * da ausência da origem.
 *
 * Por isso a recusa acontece na FRONTEIRA (o conector), antes de
 * qualquer plano, lote ou escrita: no APPLY ela é lançada dentro de
 * `prepare`, que roda antes de `startImportBatchService` — nenhuma
 * organização, nenhum vínculo e nenhum usuário chegam a ser escritos.
 *
 * ## O que NÃO é afetado
 *
 * Tudo o que não depende desta fonte continua íntegro: o catálogo de
 * empresas (que já vem do registro autoritativo), o catálogo do Portal,
 * a correspondência por CNPJ, a confirmação manual, a reconciliação e o
 * vínculo automático da criação manual de organização.
 *
 * ## Quando isto deixa de acontecer
 *
 * Quando o Helpdesk concluir a migração da autoridade de usuários e
 * publicar um registro consultável. Enquanto isso não acontecer, a
 * importação automática de usuários fica bloqueada — e este erro é o
 * registro explícito desse bloqueio, não um estado transitório de rede.
 */
export class HelpdeskUserSourceUnavailableError extends DomainError {
  public readonly code = "HELPDESK_USER_SOURCE_UNAVAILABLE";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      "A fonte de usuários do Helpdesk está temporariamente indisponível: o Helpdesk ainda não concluiu a " +
        "migração da autoridade de usuários para o registro autoritativo. Isto NÃO significa que a empresa " +
        "não tenha usuários — significa que a origem não pôde ser consultada. Nenhum lote foi aberto e nada " +
        "foi importado. O catálogo de empresas e o vínculo com o Portal seguem funcionando normalmente."
    );
  }
}
