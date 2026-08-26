import type { UnitOfWork } from "./UnitOfWork.js";
import type { Queryable } from "./Queryable.js";

/**
 * UnitOfWork que PARTICIPA de uma transação já aberta, em vez de abrir
 * outra.
 *
 * Nasceu para o APPLY do importador e vale para qualquer operação
 * composta. Escrever um usuário são vários comandos — Identity,
 * Membership, ApplicationAccess, e no importador também
 * IdentityExternalReference — e cada um tem um Application Service
 * próprio, com suas regras de unicidade e seus eventos de auditoria.
 * Chamar os serviços normalmente abriria uma transação por comando: se o
 * terceiro falhasse, os dois primeiros já estariam comitados, e o banco
 * ficaria com uma pessoa criada e sem organização nem acesso —
 * exatamente o estado parcial que estas operações proíbem.
 *
 * Mora em `shared/database` por ser infraestrutura transacional
 * genérica, ao lado do próprio `UnitOfWork`: o provisionamento
 * administrativo (bounded context `organization`) precisa da mesma
 * garantia, e buscá-la dentro do contexto `import` seria acoplar dois
 * contextos por um detalhe de conexão (ADR-014).
 *
 * Passando este adaptador aos serviços, o `runInTransaction` deles vira
 * a execução direta sobre a conexão do lote, e o COMMIT/ROLLBACK fica
 * com quem abriu a transação de fora. Ou o usuário inteiro entra, ou
 * nada dele entra — sem precisar de compensação para falha no meio do
 * caminho.
 *
 * A alternativa seria reimplementar a lógica dos serviços dentro de cada
 * chamador. Seria pior: cópias da mesma regra que divergem no primeiro
 * ajuste feito só de um lado.
 */
export class ExistingConnectionUnitOfWork implements UnitOfWork {
  public constructor(private readonly connection: Queryable) {}

  public async runInTransaction<T>(work: (connection: Queryable) => Promise<T>): Promise<T> {
    return work(this.connection);
  }
}
