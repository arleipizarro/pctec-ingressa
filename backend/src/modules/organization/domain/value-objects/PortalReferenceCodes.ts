/**
 * A referência externa que dá cobertura comercial ao Portal.
 *
 * `PCTEC_PORTAL` + `clientes` é o par que resolve uma COMPANY do
 * Ingressa para `pctecdb.clientes` — e é o ÚNICO par que produz contexto
 * comercial (decisão fechada no piloto AFIP, já aplicada em
 * `ResolvePortalTenantScopeService` e nas rotas service-to-service).
 *
 * **`clientes_grupo` nunca entra aqui, e um BUSINESS_GROUP nunca recebe
 * referência própria.** A visão consolidada de um grupo é a soma das
 * referências das empresas filhas; dar ao grupo uma referência sua
 * criaria uma segunda fonte de verdade para o mesmo número, e as duas
 * divergiriam no primeiro mês em que uma filha entrasse ou saísse.
 *
 * As strings já existiam espalhadas por `ResolvePortalTenantScopeService`
 * e pelas rotas do módulo `portal`. Centralizá-las aqui é o que permite
 * ao lado administrativo falar do MESMO par sem uma quarta cópia do
 * literal — quem consultar e quem criar a referência leem a mesma
 * constante.
 */
export const PORTAL_REFERENCE_SYSTEM_CODE = "PCTEC_PORTAL" as const;

export const PORTAL_REFERENCE_ENTITY_TYPE = "clientes" as const;
