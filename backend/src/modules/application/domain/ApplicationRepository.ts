import type { Application } from "./Application.js";
import type { PublicId } from "./value-objects/PublicId.js";
import type { ApplicationCode } from "./value-objects/ApplicationCode.js";

/**
 * Contrato de persistência de Application.
 *
 * Definido no domínio, implementado na infraestrutura
 * (`infrastructure/persistence`) — o domínio não conhece `mysql2` nem
 * qualquer detalhe de SQL. Somente-leitura nesta fatia — `Application` é
 * criada por seed técnico de migration (ver `ApplicationCodes.ts`), não
 * por comando de domínio.
 */
export interface ApplicationRepository {
  findByPublicId(publicId: PublicId): Promise<Application | undefined>;
  findByCode(code: ApplicationCode): Promise<Application | undefined>;
}
