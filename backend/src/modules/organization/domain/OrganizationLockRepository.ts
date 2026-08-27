import type { Organization } from "./Organization.js";
import type { PublicId } from "./value-objects/PublicId.js";

/**
 * Contrato de LEITURA COM BLOQUEIO da linha de uma Organization.
 *
 * Separado de `OrganizationRepository` de propósito. Quase toda operação
 * do domínio lê a organização sem bloquear nada, e obrigar as dezenas de
 * implementações existentes a responder por um `FOR UPDATE` que elas
 * nunca usam só espalharia código morto. Quem precisa de serialização
 * declara ESTE contrato, e aí o bloqueio é obrigatório — não opcional,
 * que é como um `?` no contrato compartilhado teria terminado.
 *
 * **Por que a linha da Organization, e não a da referência.** A regra a
 * proteger é "no máximo uma referência ACTIVE de PCTEC_PORTAL/clientes
 * POR ORGANIZAÇÃO". Não há linha de referência para bloquear quando
 * ainda não existe nenhuma, e a UNIQUE KEY da migration 0013 cobre outra
 * chave — `(system_code, entity_type, legacy_id)`, que não impede duas
 * referências da MESMA organização apontando para `legacyId` diferentes.
 * A linha da Organization é o único registro que existe antes da escrita
 * e que todos os concorrentes daquela empresa têm em comum: bloqueá-la
 * serializa exatamente o conjunto certo, e nada além dele — duas
 * empresas diferentes seguem em paralelo.
 *
 * Só faz sentido dentro de uma transação. Fora dela, o bloqueio é
 * liberado no fim da própria instrução e não serializa nada.
 */
export interface OrganizationLockRepository {
  /**
   * `SELECT ... FOR UPDATE` da Organization. Concorrentes na MESMA
   * organização esperam aqui; ao entrar, leem o estado já comitado por
   * quem passou antes.
   */
  lockByPublicId(publicId: PublicId): Promise<Organization | undefined>;
}
