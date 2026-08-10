import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import type { Identity } from "../../identity/domain/Identity.js";
import type { PublicId } from "../../identity/domain/value-objects/PublicId.js";
import type { CredentialRepository } from "../domain/CredentialRepository.js";
import type { Credential } from "../domain/Credential.js";
import type { CredentialType } from "../domain/value-objects/CredentialType.js";

/**
 * Fake mínimo de IdentityRepository — nunca abre rede/MariaDB real.
 * Implementa todos os métodos do contrato (a maioria como stub) porque o
 * TypeScript exige a interface completa; só `findByNormalizedEmail` é
 * de fato exercitado pelos testes de autenticação.
 */
export class FakeAuthIdentityRepository implements IdentityRepository {
  public readonly byEmail = new Map<string, Identity>();
  public findByNormalizedEmailCalls: string[] = [];

  public async findByPublicId(_publicId: PublicId): Promise<Identity | undefined> {
    return undefined;
  }

  public async findByNormalizedEmail(normalizedEmail: string): Promise<Identity | undefined> {
    this.findByNormalizedEmailCalls.push(normalizedEmail);
    return this.byEmail.get(normalizedEmail);
  }

  public async existsByNormalizedEmail(): Promise<boolean> {
    return false;
  }

  public async existsByNormalizedCpf(): Promise<boolean> {
    return false;
  }

  public async countAll(): Promise<number> {
    return this.byEmail.size;
  }

  public async insert(): Promise<void> {
    // não exercitado nesta fatia
  }

  public async update(): Promise<void> {
    // não exercitado nesta fatia
  }
}

/**
 * Fake mínimo de CredentialRepository — nunca abre rede/MariaDB real.
 */
export class FakeAuthCredentialRepository implements CredentialRepository {
  public readonly byIdentityAndType = new Map<string, Credential>();
  public updateCalls: Array<{ credential: Credential; expectedVersion: number }> = [];

  public async insert(): Promise<void> {
    // não exercitado nesta fatia
  }

  public async findByIdentityAndType(
    identityPublicId: string,
    type: CredentialType
  ): Promise<Credential | undefined> {
    return this.byIdentityAndType.get(`${identityPublicId}:${type.toString()}`);
  }

  public async existsAnyByType(): Promise<boolean> {
    return false;
  }

  public async update(credential: Credential, expectedVersion: number): Promise<void> {
    this.updateCalls.push({ credential, expectedVersion });
  }
}
