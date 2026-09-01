import { describe, it, expect } from "vitest";
import { GetActiveIdentityExternalReferenceService } from "../application/GetActiveIdentityExternalReferenceService.js";
import type { IdentityExternalReferenceRepository } from "../domain/IdentityExternalReferenceRepository.js";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { SystemCode } from "../domain/value-objects/SystemCode.js";
import type { EntityType } from "../domain/value-objects/EntityType.js";
import type { LegacyId } from "../domain/value-objects/LegacyId.js";
import { IdentityExternalReferenceNotFoundError } from "../domain/errors/IdentityExternalReferenceErrors.js";
import { InvalidSystemCodeError } from "../domain/value-objects/SystemCode.js";
import { InvalidLegacyIdError } from "../domain/value-objects/LegacyId.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const ACTOR_PUBLIC_ID = "8f14e45f-ceea-467e-a1a3-000000000001";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000002";

class InMemoryIdentityExternalReferenceRepository implements IdentityExternalReferenceRepository {
  public readonly stored: IdentityExternalReference[] = [];

  public async existsActiveBySystemCodeEntityTypeAndLegacyId(
    _s: SystemCode,
    _e: EntityType,
    _l: LegacyId
  ): Promise<boolean> {
    return false;
  }
  public async findByPublicId(publicId: PublicId): Promise<IdentityExternalReference | undefined> {
    return this.stored.find((r) => r.getPublicId().equals(publicId));
  }
  public async findActiveBySystemCodeEntityTypeAndLegacyId(
    systemCode: SystemCode,
    entityType: EntityType,
    legacyId: LegacyId
  ): Promise<IdentityExternalReference | undefined> {
    return this.stored.find(
      (r) =>
        r.isActive() &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType) &&
        r.getLegacyId().equals(legacyId)
    );
  }
  public async findActiveByIdentityAndSystemCodeAndEntityType(
    identityPublicId: string,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<IdentityExternalReference | undefined> {
    return this.stored.find(
      (r) =>
        r.isActive() &&
        r.getIdentityPublicId() === identityPublicId &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType)
    );
  }
  public async insert(reference: IdentityExternalReference): Promise<void> {
    this.stored.push(reference);
  }
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe("GetActiveIdentityExternalReferenceService — resolve a referência ACTIVE quando existe", () => {
  it("retorna a referência com identityPublicId correto dado o legacyId (direção reversa: Portal→Ingressa)", async () => {
    const repository = new InMemoryIdentityExternalReferenceRepository();
    const reference = IdentityExternalReference.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 33,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await repository.insert(reference);
    const service = new GetActiveIdentityExternalReferenceService(repository);

    const result = await service.execute("PCTEC_PORTAL", "portal_acesso", 33);

    expect(result.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
    expect(result.getLegacyId().toNumber()).toBe(33);
    expect(result.getSystemCode().toString()).toBe("PCTEC_PORTAL");
    expect(result.getEntityType().toString()).toBe("portal_acesso");
    expect(result.getMatchMethod().toString()).toBe("MATCHED_MANUAL_CONFIRMED");
  });
});

describe("GetActiveIdentityExternalReferenceService — lança NotFoundError quando não há referência", () => {
  it("lança IdentityExternalReferenceNotFoundError (404) quando não há referência para essa chave legada", async () => {
    const repository = new InMemoryIdentityExternalReferenceRepository();
    const service = new GetActiveIdentityExternalReferenceService(repository);

    await expect(service.execute("PCTEC_PORTAL", "portal_acesso", 33)).rejects.toThrow(
      IdentityExternalReferenceNotFoundError
    );
  });
});

describe("GetActiveIdentityExternalReferenceService — referência SUPERSEDED não conta como ACTIVE", () => {
  it("mesmo comportamento de 'não encontrada' quando só existe SUPERSEDED", async () => {
    const repository = new InMemoryIdentityExternalReferenceRepository();
    const superseded = IdentityExternalReference.reconstitute({
      internalId: 1,
      publicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000099",
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 33,
      matchMethod: "MATCHED_BY_EMAIL",
      status: "SUPERSEDED",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    repository.stored.push(superseded);
    const service = new GetActiveIdentityExternalReferenceService(repository);

    await expect(service.execute("PCTEC_PORTAL", "portal_acesso", 33)).rejects.toThrow(
      IdentityExternalReferenceNotFoundError
    );
  });
});

describe("GetActiveIdentityExternalReferenceService — entityType diferente não satisfaz a busca", () => {
  it("referência para entityType='clientes' NÃO satisfaz busca por 'portal_acesso'", async () => {
    const repository = new InMemoryIdentityExternalReferenceRepository();
    const otherEntityType = IdentityExternalReference.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_HUB",
      entityType: "clientes",
      legacyId: 33,
      matchMethod: "MATCHED_BY_EMAIL",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await repository.insert(otherEntityType);
    const service = new GetActiveIdentityExternalReferenceService(repository);

    await expect(service.execute("PCTEC_HUB", "portal_acesso", 33)).rejects.toThrow(
      IdentityExternalReferenceNotFoundError
    );
  });
});

describe("GetActiveIdentityExternalReferenceService — valida inputs via value objects", () => {
  it("rejeita systemCode inválido antes de consultar o repository", async () => {
    const repository = new InMemoryIdentityExternalReferenceRepository();
    const service = new GetActiveIdentityExternalReferenceService(repository);

    await expect(service.execute("PCTEC_INVALIDO", "portal_acesso", 33)).rejects.toThrow(
      InvalidSystemCodeError
    );
  });

  it("rejeita legacyId zero ou negativo antes de consultar o repository", async () => {
    const repository = new InMemoryIdentityExternalReferenceRepository();
    const service = new GetActiveIdentityExternalReferenceService(repository);

    await expect(service.execute("PCTEC_PORTAL", "portal_acesso", 0)).rejects.toThrow(
      InvalidLegacyIdError
    );
    await expect(service.execute("PCTEC_PORTAL", "portal_acesso", -1)).rejects.toThrow(
      InvalidLegacyIdError
    );
  });
});

describe("GetActiveIdentityExternalReferenceService — aceita legacyId como string numérica", () => {
  it("legacyId='33' (string) funciona igual a legacyId=33 (number)", async () => {
    const repository = new InMemoryIdentityExternalReferenceRepository();
    const reference = IdentityExternalReference.create({
      identityPublicId: IDENTITY_PUBLIC_ID,
      systemCode: "PCTEC_PORTAL",
      entityType: "portal_acesso",
      legacyId: 33,
      matchMethod: "MATCHED_MANUAL_CONFIRMED",
      actorPublicId: ACTOR_PUBLIC_ID,
      correlationId: CORRELATION_ID
    });
    await repository.insert(reference);
    const service = new GetActiveIdentityExternalReferenceService(repository);

    const result = await service.execute("PCTEC_PORTAL", "portal_acesso", "33");

    expect(result.getLegacyId().toNumber()).toBe(33);
    expect(result.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
  });
});

describe("GetActiveIdentityExternalReferenceService — nunca recebe identityPublicId como parâmetro", () => {
  it("assinatura do método tem exatamente 3 parâmetros: (systemCode, entityType, legacyId) — nunca identityPublicId", () => {
    const repository = new InMemoryIdentityExternalReferenceRepository();
    const service = new GetActiveIdentityExternalReferenceService(repository);

    // Checagem estrutural: boundary — o browser nunca é a autoridade sobre
    // qual Identity corresponde a um portal_acesso.id. A assinatura reflete
    // isso: não há parâmetro para identityPublicId.
    expect(service.execute.length).toBe(3);
  });
});
