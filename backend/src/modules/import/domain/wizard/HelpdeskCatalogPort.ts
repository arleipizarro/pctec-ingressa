import type { HelpdeskClientRecord, HelpdeskUserRecord } from "../pilot/HelpdeskSourcePort.js";

/**
 * Porta de CATÁLOGO da fonte Helpdesk — o que o assistente mostra ao
 * ADMIN antes de qualquer decisão.
 *
 * Reusa `HelpdeskClientRecord`/`HelpdeskUserRecord` do piloto de
 * propósito: são exatamente os mesmos campos, pelas mesmas razões, e
 * duplicar os tipos criaria dois lugares para a lista de colunas
 * permitidas divergir.
 *
 * ------------------------------------------------------------------
 * GRUPO EMPRESARIAL — o que esta porta NÃO tem, e por quê
 * ------------------------------------------------------------------
 *
 * A task desta fatia pede catálogo de grupos empresariais e do vínculo
 * explícito grupo → empresa. Ele não está aqui, e a ausência é uma
 * conclusão verificada, não um esquecimento:
 *
 *  - o principal read-only da fonte tem SELECT de COLUNA em exatamente
 *    cinco colunas do cadastro de empresas — `clientes(id, nome,
 *    tipo_doc, documento, ativo)` no registro autoritativo. Nenhuma
 *    tabela nem coluna de grupo está concedida;
 *  - grupo empresarial não é sequer tabela do Helpdesk: o Helpdesk lê
 *    `pctecdb.clientes_grupo` e `pctecdb.clientes_grupo_membros` —
 *    banco do HUB, outro sistema (ADR-031), fora do alcance deste
 *    conector e de `PCTEC_HELPDESK` como `system_code`;
 *  - a auditoria do próprio Helpdesk continua valendo: a visibilidade
 *    de chamado lá é filtrada por `client_id`, nunca por
 *    `client_group_id` — grupo é classificação, não concessão.
 *
 * A task manda parar e justificar antes de ampliar privilégio. Foi o
 * que se fez. A consequência para o assistente: a relação grupo →
 * empresa continua possível, mas como AFIRMAÇÃO EXPLÍCITA do ADMIN
 * (`parentBusinessGroupPublicId`, um BUSINESS_GROUP que já existe no
 * Ingressa), verificada pelo backend — nunca inferida da origem.
 */
export interface HelpdeskCatalogPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface HelpdeskCatalogQuery {
  readonly q?: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface HelpdeskCatalogReader {
  /** Empresas/clientes do Helpdesk, paginadas. Nunca a base inteira. */
  readClients(query: HelpdeskCatalogQuery): Promise<HelpdeskCatalogPage<HelpdeskClientRecord>>;

  /**
   * Usuários de UMA empresa.
   *
   * O contrato prevê todos os papéis, não só `cliente`: o ADMIN precisa
   * VER que existe um interno vinculado àquela empresa para entender por
   * que ele não é importável. Esconder o registro faria a tela mentir
   * por omissão.
   *
   * A implementação real RECUSA hoje, com
   * `HELPDESK_USER_SOURCE_UNAVAILABLE`: o Helpdesk ainda não migrou a
   * autoridade de usuários. O método fica no contrato para que a
   * indisponibilidade seja uma recusa explícita, e não uma lista vazia
   * em quem chama.
   */
  readUsersByClientId(clientId: number): Promise<readonly HelpdeskUserRecord[]>;
}
