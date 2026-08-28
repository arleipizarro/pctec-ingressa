import type { PortalClientRecord } from "./PortalClientCatalogPort.js";

/**
 * Resultado da correspondência entre uma Organization do Ingressa e um
 * cliente do Portal.
 *
 * Quatro estados, e a assimetria entre eles é o desenho:
 *
 * - `EXACT_UNIQUE` — exatamente UM cliente com o mesmo CNPJ
 *   normalizado. **É o único estado que autoriza vínculo automático.**
 * - `NOT_FOUND` — nenhum. A empresa existe no Ingressa e ainda não tem
 *   correspondente no Portal, ou tem sob outro documento.
 * - `AMBIGUOUS` — mais de um. Fail-closed: nada é escolhido, nem pelo
 *   servidor nem pela tela. Escolher "o primeiro" aqui seria o mesmo
 *   erro que `LIMIT 1` esconde.
 * - `DOCUMENT_MISSING_OR_INVALID` — a Organization não tem CNPJ
 *   comparável. Não é falha: é a maioria dos casos vindos do importador
 *   hoje, e o caminho dela é a seleção administrativa.
 *
 * **Nunca existe um estado "parecido por nome".** Razão social e nome
 * fantasia divergem entre sistemas, se repetem entre filiais e mudam
 * sem aviso; um match por nome erra em silêncio e o erro só aparece
 * quando alguém lê o faturamento da empresa errada.
 */
export type PortalClientMatchStatus =
  | "EXACT_UNIQUE"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "DOCUMENT_MISSING_OR_INVALID";

export interface PortalClientMatchResult {
  readonly status: PortalClientMatchStatus;
  /** Preenchido SOMENTE em `EXACT_UNIQUE`. Em `AMBIGUOUS` fica `undefined` de propósito. */
  readonly client: PortalClientRecord | undefined;
  /** Quantos clientes do Portal têm este CNPJ. `0` quando não há documento comparável. */
  readonly candidateCount: number;
}
