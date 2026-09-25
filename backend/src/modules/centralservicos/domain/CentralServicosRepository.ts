import type { DelegationAssertionRecord, NewDelegationAssertion } from "./DelegationAssertion.js";

export interface IdentityAuthorizationRow {
  readonly fullName: string;
  readonly status: string;
  readonly accessProfile: string | null;
}

/**
 * Persistência do módulo. Porta explícita para que os testes do serviço
 * rodem sem banco; a implementação MariaDB vive em `infrastructure`.
 */
export interface CentralServicosRepository {
  /** Identidade (não DELETED) + perfil GRANTED na aplicação informada. */
  identityAuthorization(identityPublicId: string, applicationPublicId: string): Promise<IdentityAuthorizationRow | undefined>;
  /** Perfis GRANTED e ACTIVE da pessoa na aplicação. */
  grantedRoles(identityPublicId: string, applicationPublicId: string): Promise<readonly string[]>;
  /** Lança DelegationAssertionAlreadyIssuedError se a ação já tem asserção. */
  insertAssertion(assertion: NewDelegationAssertion): Promise<void>;
  assertionByTokenHash(tokenHash: string): Promise<DelegationAssertionRecord | undefined>;
  /** Consumo atômico: true só para quem efetivamente consumiu. */
  consumeAssertion(id: number, consumer: string, at: Date): Promise<boolean>;
  applicationCodeByPublicId(publicId: string): Promise<string | undefined>;
}
