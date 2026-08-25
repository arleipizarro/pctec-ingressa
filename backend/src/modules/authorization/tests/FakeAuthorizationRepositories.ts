import type { ApplicationRepository } from "../../application/domain/ApplicationRepository.js";
import type { Application } from "../../application/domain/Application.js";
import type { PublicId } from "../../application/domain/value-objects/PublicId.js";
import type { ApplicationCode } from "../../application/domain/value-objects/ApplicationCode.js";
import type { ApplicationAccessRepository } from "../../application/domain/ApplicationAccessRepository.js";
import type { ApplicationAccess } from "../../application/domain/ApplicationAccess.js";

export class FakeApplicationRepository implements ApplicationRepository {
  public readonly byCode = new Map<string, Application>();
  public findByCodeCalls: string[] = [];

  public async findByPublicId(_publicId: PublicId): Promise<Application | undefined> {
    return undefined;
  }

  public async findByCode(code: ApplicationCode): Promise<Application | undefined> {
    this.findByCodeCalls.push(code.toString());
    return this.byCode.get(code.toString());
  }
}

export class FakeApplicationAccessRepository implements ApplicationAccessRepository {
  public async findByPublicId(): Promise<undefined> {
    return undefined;
  }

  /** Revogação não é exercida por estes testes; o double só satisfaz o contrato. */
  public async update(): Promise<void> {
    return undefined;
  }

  public readonly byIdentityAndApplication = new Map<string, ApplicationAccess>();
  public findByIdentityAndApplicationCalls: Array<{ identityPublicId: string; applicationPublicId: string }> = [];

  public async existsGrantedByApplicationAndProfile(): Promise<boolean> {
    return false;
  }

  public async existsGrantedByIdentityApplicationAndProfile(): Promise<boolean> {
    return false;
  }

  public async existsGrantedByIdentityAndApplication(): Promise<boolean> {
    return false;
  }

  public async insert(): Promise<void> {
    // não exercitado nesta fatia
  }

  public async findByIdentityAndApplication(
    identityPublicId: string,
    applicationPublicId: string
  ): Promise<ApplicationAccess | undefined> {
    this.findByIdentityAndApplicationCalls.push({ identityPublicId, applicationPublicId });
    return this.byIdentityAndApplication.get(`${identityPublicId}:${applicationPublicId}`);
  }
}
