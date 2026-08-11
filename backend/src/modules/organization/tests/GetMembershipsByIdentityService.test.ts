import { describe, it, expect } from "vitest";
import { GetMembershipsByIdentityService } from "../application/GetMembershipsByIdentityService.js";
import type { MembershipRepository } from "../domain/MembershipRepository.js";
import { Membership } from "../domain/Membership.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { MembershipProfile } from "../domain/value-objects/MembershipProfile.js";
import { InvalidPublicIdError } from "../../identity/domain/value-objects/PublicId.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

class InMemoryMembershipRepository implements MembershipRepository {
  public readonly stored: Membership[] = [];

  public async existsByIdentityOrganizationAndProfile(
    identityPublicId: string,
    organizationPublicId: string,
    profile: MembershipProfile
  ): Promise<boolean> {
    return this.stored.some(
      (m) =>
        m.getIdentityPublicId() === identityPublicId &&
        m.getOrganizationPublicId() === organizationPublicId &&
        m.getProfile().equals(profile)
    );
  }
  public async findAllByIdentityPublicId(identityPublicId: string): Promise<Membership[]> {
    return this.stored.filter((m) => m.getIdentityPublicId() === identityPublicId);
  }
  public async findByPublicId(publicId: PublicId): Promise<Membership | undefined> {
    return this.stored.find((m) => m.getPublicId().equals(publicId));
  }
  public async insert(membership: Membership): Promise<void> {
    this.stored.push(membership);
  }
}

describe("GetMembershipsByIdentityService", () => {
  it("retorna todos os Memberships de uma Identity, múltiplas Organizations", async () => {
    const repository = new InMemoryMembershipRepository();
    const membershipA = Membership.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000001",
      profile: "CUSTOMER",
      scope: "ORGANIZATION_ONLY",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    const membershipB = Membership.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      organizationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000002",
      profile: "PARTNER",
      scope: "ORGANIZATION_AND_DESCENDANTS",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await repository.insert(membershipA);
    await repository.insert(membershipB);
    const service = new GetMembershipsByIdentityService(repository);

    const result = await service.execute(IDENTITY_PUBLIC_ID);

    expect(result).toHaveLength(2);
  });

  it("retorna lista vazia quando a Identity não tem nenhum Membership (não é erro)", async () => {
    const repository = new InMemoryMembershipRepository();
    const service = new GetMembershipsByIdentityService(repository);

    const result = await service.execute("0b13f6f0-8f3a-4a1e-9c2d-000000000099");

    expect(result).toEqual([]);
  });

  it("lança InvalidPublicIdError quando o publicId não é um UUID válido", async () => {
    const repository = new InMemoryMembershipRepository();
    const service = new GetMembershipsByIdentityService(repository);

    await expect(service.execute("nao-e-um-uuid")).rejects.toThrow(InvalidPublicIdError);
  });
});
