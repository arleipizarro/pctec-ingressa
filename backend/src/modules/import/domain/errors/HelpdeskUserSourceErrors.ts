import { DomainError } from "../../../../shared/errors/DomainError.js";

/**
 * A fonte de USUÁRIOS do Helpdesk não pôde ser consultada.
 *
 * ## O que este erro significa — e o que ele significava antes
 *
 * Ele nasceu (v0.12.x, commit `a9b052b`) como uma recusa
 * INCONDICIONAL, sobre uma premissa que se provou falsa: a de que a
 * `migration_005` do Helpdesk havia removido a tabela de usuários e que
 * o Helpdesk esperava concluir uma migração de autoridade. A migration
 * está em QUARENTENA no manifesto do próprio Helpdesk
 * (`baselineable: "never"`, `quarantined: true`) e nunca foi aplicada:
 * a tabela existe, é lida pela autenticação do Helpdesk e é onde
 * `role`, `client_id` e `active` são gravados. Ver
 * `docs/import/FONTE-HELPDESK-CONTRATO-ATUAL.md` para a evidência.
 *
 * Hoje o erro é lançado apenas quando a fonte de fato não respondeu:
 * privilégio negado, schema/tabela/coluna inexistente, ou transporte
 * caído. Ver `ehFonteInalcancavel`, em
 * `MariaDbHelpdeskReadOnlySource`, para a lista fechada — e para o
 * motivo de ela ser fechada.
 *
 * ## Por que continua sendo uma RECUSA, e nunca uma lista vazia
 *
 * Esta é a distinção que o erro existe para proteger, e ela sobrevive
 * à correção da premissa. "Não consegui perguntar" e "perguntei e não
 * há ninguém" levam a ações opostas: a segunda convida o ADMIN a
 * concluir a importação sem usuários, ou a cadastrá-los de novo à mão —
 * decisões tomadas sobre uma informação que ninguém verificou. Devolver
 * `[]`, `NOT_FOUND` ou um lote COMPLETED sem usuários seria afirmar um
 * fato sobre a origem a partir da ausência da origem.
 *
 * Por isso a recusa acontece na FRONTEIRA (o conector), antes de
 * qualquer plano, lote ou escrita: no APPLY ela é lançada dentro de
 * `prepare`, que roda antes de `startImportBatchService` — nenhuma
 * organização, nenhum vínculo e nenhum usuário chegam a ser escritos.
 *
 * ## O que ele NÃO cobre
 *
 * Erro de programação não vira indisponibilidade. SQL malformado
 * (`ER_PARSE_ERROR`), recusa da guarda `assertReadOnlySourceQuery` e
 * qualquer exceção fora da lista sobem cruas e viram 500 — que é a
 * resposta honesta para "isto não deveria ter acontecido". Traduzir
 * tudo em 503 mandaria quem opera investigar o Helpdesk por um defeito
 * nosso.
 *
 * ## O que NÃO é afetado quando ele acontece
 *
 * Tudo o que não depende desta fonte continua íntegro: o catálogo de
 * empresas (que vem do registro autoritativo), o catálogo do Portal,
 * a correspondência por CNPJ, a confirmação manual, a reconciliação e o
 * vínculo automático da criação manual de organização.
 */
export class HelpdeskUserSourceUnavailableError extends DomainError {
  public readonly code = "HELPDESK_USER_SOURCE_UNAVAILABLE";
  public readonly classification = "VALIDATION" as const;

  constructor() {
    super(
      "A fonte de usuários do Helpdesk está temporariamente indisponível: não foi possível consultá-la. " +
        "Isto NÃO significa que a empresa não tenha usuários — significa que a origem não pôde ser lida. " +
        "Nenhum lote foi aberto e nada foi importado. O catálogo de empresas e o vínculo com o Portal " +
        "seguem funcionando normalmente."
    );
  }
}
