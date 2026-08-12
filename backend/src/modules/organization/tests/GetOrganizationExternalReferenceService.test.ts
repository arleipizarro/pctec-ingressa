import { describe, it, expect } from "vitest";
import { GetOrganizationExternalReferenceService } from "../application/GetOrganizationExternalReferenceService.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { SystemCode } from "../domain/value-objects/SystemCode.js";
import type { EntityType } from "../domain/value-objects/EntityType.js";
import type { LegacyId } from "../domain/value-objects/LegacyId.js";
import { InvalidOrganizationPublicIdError } from "../domain/value-objects/PublicId.js";

class InMemoryOrganizationExternalReferenceRepository implements OrganizationExternalReferenceRepository {
  public readonly stored: OrganizationExternalReference[] = [];
  public async existsActiveBySystemCodeEntityTypeAndLegacyId(
    _s: SystemCode,
    _e: EntityType,
    _l: LegacyId
  ): Promise<boolean> {
    return false;
  }
  public async findByPublicId(publicId: PublicId): Promise<OrganizationExternalReference | undefined> {
    return this.stored.find((r) => r.getPublicId().equals(publicId));
  }
  public async findActiveByOrganizationSystemCodeAndEntityType(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<OrganizationExternalReference | undefined> {
    return this.stored.find(
      (r) =>
        r.isActive() &&
        r.getOrganizationPublicId() === organizationPublicId.toString() &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType)
    );
  }
  public async insert(reference: OrganizationExternalReference): Promise<void> {
    this.stored.push(reference);
  }
}

const ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

describe("GetOrganizationExternalReferenceService", () => {
  it("retorna a referência quando o publicId existe", async () => {
    const repository = new InMemoryOrganizationExternalReferenceRepository();
    const reference = OrganizationExternalReference.create({
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 1,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: "8f14e45f-ceea-467e-a1a3-000000000001"
    });
    await repository.insert(reference);
    const service = new GetOrganizationExternalReferenceService(repository);

    const result = await service.execute(reference.getPublicId().toString());

    expect(result?.getPublicId().toString()).toBe(reference.getPublicId().toString());
  });

  it("retorna undefined (não lança) quando o publicId não existe", async () => {
    const repository = new InMemoryOrganizationExternalReferenceRepository();
    const service = new GetOrganizationExternalReferenceService(repository);

    const result = await service.execute("0b13f6f0-8f3a-4a1e-9c2d-000000000099");

    expect(result).toBeUndefined();
  });

  it("lança InvalidOrganizationPublicIdError quando o publicId não é um UUID válido", async () => {
    const repository = new InMemoryOrganizationExternalReferenceRepository();
    const service = new GetOrganizationExternalReferenceService(repository);

    await expect(service.execute("nao-e-um-uuid")).rejects.toThrow(InvalidOrganizationPublicIdError);
  });
});
