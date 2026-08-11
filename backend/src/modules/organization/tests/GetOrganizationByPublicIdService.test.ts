import { describe, it, expect } from "vitest";
import { GetOrganizationByPublicIdService } from "../application/GetOrganizationByPublicIdService.js";
import type { OrganizationRepository } from "../domain/OrganizationRepository.js";
import { Organization } from "../domain/Organization.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { OrganizationType } from "../domain/value-objects/OrganizationType.js";
import type { DocumentNumber } from "../domain/value-objects/DocumentNumber.js";
import { InvalidOrganizationPublicIdError } from "../domain/value-objects/PublicId.js";
import { OrganizationNotFoundError } from "../domain/errors/OrganizationErrors.js";

class InMemoryOrganizationRepository implements OrganizationRepository {
  public readonly stored = new Map<string, Organization>();

  public async findByPublicId(publicId: PublicId): Promise<Organization | undefined> {
    return this.stored.get(publicId.toString());
  }

  public async existsByDocumentNumberAndType(_documentNumber: DocumentNumber, _type: OrganizationType): Promise<boolean> {
    return false;
  }

  public async insert(organization: Organization): Promise<void> {
    this.stored.set(organization.getPublicId().toString(), organization);
  }
}

const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

describe("GetOrganizationByPublicIdService", () => {
  it("retorna a Organization quando o publicId existe", async () => {
    const organizationRepository = new InMemoryOrganizationRepository();
    const organization = Organization.create({
      type: "COMPANY",
      legalName: "Empresa Consultada",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    await organizationRepository.insert(organization);
    const service = new GetOrganizationByPublicIdService(organizationRepository);

    const result = await service.execute(organization.getPublicId().toString());

    expect(result.getPublicId().toString()).toBe(organization.getPublicId().toString());
  });

  it("lança OrganizationNotFoundError quando o publicId não existe", async () => {
    const organizationRepository = new InMemoryOrganizationRepository();
    const service = new GetOrganizationByPublicIdService(organizationRepository);

    await expect(service.execute("0b13f6f0-8f3a-4a1e-9c2d-000000000099")).rejects.toThrow(
      OrganizationNotFoundError
    );
  });

  it("lança InvalidOrganizationPublicIdError quando o publicId não é um UUID válido", async () => {
    const organizationRepository = new InMemoryOrganizationRepository();
    const service = new GetOrganizationByPublicIdService(organizationRepository);

    await expect(service.execute("nao-e-um-uuid")).rejects.toThrow(InvalidOrganizationPublicIdError);
  });
});
