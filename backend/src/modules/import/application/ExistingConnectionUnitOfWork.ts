import type { UnitOfWork } from "../../../shared/database/UnitOfWork.js";
import type { Queryable } from "../../../shared/database/Queryable.js";

/**
 * UnitOfWork que PARTICIPA de uma transação já aberta, em vez de abrir
 * outra.
 *
 * Existe por um motivo específico do APPLY. Escrever um usuário do
 * piloto são quatro comandos — Identity, IdentityExternalReference,
 * Membership, ApplicationAccess — e cada um deles tem um Application
 * Service próprio, com suas regras de unicidade e seus eventos de
 * auditoria. Chamar os quatro serviços normalmente abriria QUATRO
 * transações independentes: se a terceira falhasse, as duas primeiras já
 * estariam comitadas, e o banco ficaria com uma pessoa criada, vinculada
 * ao Helpdesk e sem organização nem acesso — exatamente o estado parcial
 * que esta fatia proíbe.
 *
 * Passando este adaptador aos serviços, o `runInTransaction` deles vira
 * a execução direta sobre a conexão do lote, e o COMMIT/ROLLBACK fica
 * com quem abriu a transação de fora. Ou o usuário inteiro entra, ou
 * nada dele entra — sem precisar de compensação para falha no meio do
 * caminho.
 *
 * A alternativa seria reimplementar a lógica dos quatro serviços dentro
 * do importador. Seria pior: duas cópias da mesma regra que divergem no
 * primeiro ajuste feito só de um lado.
 */
export class ExistingConnectionUnitOfWork implements UnitOfWork {
  public constructor(private readonly connection: Queryable) {}

  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    return work(this.connection);
  }
}
