import { describe, it, expect } from "vitest";
import { GetActiveOrganizationExternalReferenceService } from "../application/GetActiveOrganizationExternalReferenceService.js";
import type { OrganizationExternalReferenceRepository } from "../domain/OrganizationExternalReferenceRepository.js";
import { OrganizationExternalReference } from "../domain/OrganizationExternalReference.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { SystemCode } from "../domain/value-objects/SystemCode.js";
import type { EntityType } from "../domain/value-objects/EntityType.js";
import type { LegacyId } from "../domain/value-objects/LegacyId.js";
import { OrganizationExternalReferenceNotFoundError } from "../domain/errors/OrganizationExternalReferenceErrors.js";
import { InvalidOrganizationPublicIdError } from "../domain/value-objects/PublicId.js";

const ORGANIZATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const ACTOR_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

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
  /**
   * Estes duplos nunca modelam ambiguidade — nenhuma destas suítes trata
   * de "duas referências ACTIVE para a mesma organização". Delegar à
   * busca de uma só mantém o duplo honesto sobre o que ele representa,
   * em vez de inventar um segundo armazenamento paralelo.
   */
  public async findAllActiveByOrganizationSystemCodeAndEntityType(
    organizationPublicId: PublicId,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<readonly OrganizationExternalReference[]> {
    const unica = await this.findActiveByOrganizationSystemCodeAndEntityType(
      organizationPublicId,
      systemCode,
      entityType
    );
    return unica === undefined ? [] : [unica];
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

describe("GetActiveOrganizationExternalReferenceService", () => {
  it("D/E) resolve a referência ACTIVE quando existe, com legacyId correto", async () => {
    const repository = new InMemoryOrganizationExternalReferenceRepository();
    const reference = OrganizationExternalReference.create({
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 75,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await repository.insert(reference);
    const service = new GetActiveOrganizationExternalReferenceService(repository);

    const result = await service.execute(ORGANIZATION_PUBLIC_ID, "PCTEC_PORTAL", "clientes");

    expect(result.getLegacyId().toNumber()).toBe(75);
    expect(result.getSystemCode().toString()).toBe("PCTEC_PORTAL");
    expect(result.getEntityType().toString()).toBe("clientes");
  });

  it("G) lança OrganizationExternalReferenceNotFoundError (404) quando não há referência para essa Organization/sistema/entidade", async () => {
    const repository = new InMemoryOrganizationExternalReferenceRepository();
    const service = new GetActiveOrganizationExternalReferenceService(repository);

    await expect(service.execute(ORGANIZATION_PUBLIC_ID, "PCTEC_PORTAL", "clientes")).rejects.toThrow(
      OrganizationExternalReferenceNotFoundError
    );
  });

  it("H) referência SUPERSEDED não conta como ACTIVE — mesmo comportamento de 'não encontrada'", async () => {
    const repository = new InMemoryOrganizationExternalReferenceRepository();
    const supersededReference = OrganizationExternalReference.reconstitute({
      internalId: 1,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099",
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes",
      legacyId: 75,
      status: "SUPERSEDED",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    repository.stored.push(supersededReference);
    const service = new GetActiveOrganizationExternalReferenceService(repository);

    await expect(service.execute(ORGANIZATION_PUBLIC_ID, "PCTEC_PORTAL", "clientes")).rejects.toThrow(
      OrganizationExternalReferenceNotFoundError
    );
  });

  it("I) referência para entityType='clientes_grupo' NÃO satisfaz busca por 'clientes' — sistemas diferentes de entidade nunca se confundem", async () => {
    const repository = new InMemoryOrganizationExternalReferenceRepository();
    const groupReference = OrganizationExternalReference.create({
      organizationPublicId: ORGANIZATION_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "clientes_grupo",
      legacyId: 27,
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await repository.insert(groupReference);
    const service = new GetActiveOrganizationExternalReferenceService(repository);

    await expect(service.execute(ORGANIZATION_PUBLIC_ID, "PCTEC_PORTAL", "clientes")).rejects.toThrow(
      OrganizationExternalReferenceNotFoundError
    );
  });

  it("lança InvalidOrganizationPublicIdError quando organizationPublicId não é um UUID válido", async () => {
    const repository = new InMemoryOrganizationExternalReferenceRepository();
    const service = new GetActiveOrganizationExternalReferenceService(repository);

    await expect(service.execute("nao-e-um-uuid", "PCTEC_PORTAL", "clientes")).rejects.toThrow(
      InvalidOrganizationPublicIdError
    );
  });

  it("nunca recebe nem consulta identityPublicId — assinatura do método não tem espaço para isso (boundary: autorização é responsabilidade anterior)", () => {
    const repository = new InMemoryOrganizationExternalReferenceRepository();
    const service = new GetActiveOrganizationExternalReferenceService(repository);

    // Checagem estrutural: a assinatura pública de `execute` só aceita
    // 3 parâmetros (organizationPublicId, systemCode, entityType) —
    // nunca identityPublicId, nunca AuthenticatedPrincipal.
    expect(service.execute.length).toBe(3);
  });
});
