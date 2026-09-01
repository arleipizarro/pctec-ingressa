/**
 * `GetActiveIdentityExternalReferenceByIdentityService` — direção
 * `Identity → (systemCode, entityType)`, acrescentada na fundação do
 * PCTEC Meu RH.
 *
 * Nenhum dado real: public_ids sintéticos, legacyIds na faixa 9999xx.
 */
import { describe, expect, it } from "vitest";

import { GetActiveIdentityExternalReferenceByIdentityService } from "../application/GetActiveIdentityExternalReferenceByIdentityService.js";
import { IdentityExternalReference } from "../domain/IdentityExternalReference.js";
import type { IdentityExternalReferenceRepository } from "../domain/IdentityExternalReferenceRepository.js";
import {
  IdentityExternalReferenceBindingAmbiguousError,
  IdentityExternalReferenceBindingNotFoundError
} from "../domain/errors/IdentityExternalReferenceErrors.js";
import { InvalidPublicIdError } from "../domain/value-objects/PublicId.js";
import type { PublicId } from "../domain/value-objects/PublicId.js";
import type { SystemCode } from "../domain/value-objects/SystemCode.js";
import type { EntityType } from "../domain/value-objects/EntityType.js";
import type { LegacyId } from "../domain/value-objects/LegacyId.js";

const IDENTIDADE = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const OUTRA_IDENTIDADE = "0b13f6f0-8f3a-4a1e-9c2d-000000000099";
const ATOR = "8f14e45f-ceea-467e-a1a3-000000000001";
const CORRELACAO = "8f14e45f-ceea-467e-a1a3-000000000002";

class RepositorioEmMemoria implements IdentityExternalReferenceRepository {
  public readonly stored: IdentityExternalReference[] = [];
  /** Liga a contagem opcional — usada para exercitar o caminho de ambiguidade. */
  public contagemHabilitada = true;

  public async existsActiveBySystemCodeEntityTypeAndLegacyId(): Promise<boolean> {
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
    return this.ativas(identityPublicId, systemCode, entityType)[0];
  }
  public async countActiveByIdentityAndSystemCodeAndEntityType(
    identityPublicId: string,
    systemCode: SystemCode,
    entityType: EntityType
  ): Promise<number> {
    if (!this.contagemHabilitada) {
      return 0;
    }
    return this.ativas(identityPublicId, systemCode, entityType).length;
  }
  public async insert(reference: IdentityExternalReference): Promise<void> {
    this.stored.push(reference);
  }

  private ativas(
    identityPublicId: string,
    systemCode: SystemCode,
    entityType: EntityType
  ): IdentityExternalReference[] {
    return this.stored.filter(
      (r) =>
        r.isActive() &&
        r.getIdentityPublicId() === identityPublicId &&
        r.getSystemCode().equals(systemCode) &&
        r.getEntityType().equals(entityType)
    );
  }
}

function ativa(props: {
  identityPublicId: string;
  systemCode: string;
  entityType: string;
  legacyId: number;
}): IdentityExternalReference {
  return IdentityExternalReference.create({
    ...props,
    matchMethod: "MATCHED_MANUAL_CONFIRMED",
    actorPublicId: ATOR,
    correlationId: CORRELACAO
  });
}

function superada(props: {
  identityPublicId: string;
  systemCode: string;
  entityType: string;
  legacyId: number;
}): IdentityExternalReference {
  return IdentityExternalReference.reconstitute({
    internalId: 1,
    publicId: "99999999-9999-4999-8999-999999999999",
    identityPublicId: props.identityPublicId,
    systemCode: props.systemCode,
    entityType: props.entityType,
    legacyId: props.legacyId,
    matchMethod: "MATCHED_BY_EMAIL",
    status: "SUPERSEDED",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z")
  });
}

function montar(): { repositorio: RepositorioEmMemoria; service: GetActiveIdentityExternalReferenceByIdentityService } {
  const repositorio = new RepositorioEmMemoria();
  return { repositorio, service: new GetActiveIdentityExternalReferenceByIdentityService(repositorio) };
}

describe("resolução Identity → registro no sistema de origem", () => {
  it("com binding ACTIVE, retorna EXATAMENTE uma referência, com o legacyId do sistema de origem", async () => {
    const { repositorio, service } = montar();
    await repositorio.insert(
      ativa({ identityPublicId: IDENTIDADE, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 999801 })
    );

    const encontrada = await service.execute(IDENTIDADE, "PCTEC_HUB", "rh_colaboradores");

    expect(encontrada.getIdentityPublicId()).toBe(IDENTIDADE);
    expect(encontrada.getLegacyId().toNumber()).toBe(999801);
    expect(encontrada.isActive()).toBe(true);
  });

  it("sem nenhuma referência, recusa com IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND", async () => {
    const { service } = montar();

    await expect(service.execute(IDENTIDADE, "PCTEC_HUB", "rh_colaboradores")).rejects.toBeInstanceOf(
      IdentityExternalReferenceBindingNotFoundError
    );
  });

  it("referência SUPERSEDED NUNCA é devolvida como ACTIVE", async () => {
    const { repositorio, service } = montar();
    repositorio.stored.push(
      superada({ identityPublicId: IDENTIDADE, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 999802 })
    );

    await expect(service.execute(IDENTIDADE, "PCTEC_HUB", "rh_colaboradores")).rejects.toBeInstanceOf(
      IdentityExternalReferenceBindingNotFoundError
    );
  });

  it("systemCode diferente NÃO mistura resultados", async () => {
    const { repositorio, service } = montar();
    await repositorio.insert(
      ativa({ identityPublicId: IDENTIDADE, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 999803 })
    );

    await expect(service.execute(IDENTIDADE, "PCTEC_HELPDESK", "rh_colaboradores")).rejects.toBeInstanceOf(
      IdentityExternalReferenceBindingNotFoundError
    );
  });

  it("entityType diferente NÃO mistura resultados", async () => {
    const { repositorio, service } = montar();
    await repositorio.insert(
      ativa({ identityPublicId: IDENTIDADE, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 999804 })
    );

    await expect(service.execute(IDENTIDADE, "PCTEC_HUB", "usuarios")).rejects.toBeInstanceOf(
      IdentityExternalReferenceBindingNotFoundError
    );
  });

  it("Identity diferente NÃO recebe o binding de outra pessoa", async () => {
    const { repositorio, service } = montar();
    await repositorio.insert(
      ativa({ identityPublicId: IDENTIDADE, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 999805 })
    );

    await expect(service.execute(OUTRA_IDENTIDADE, "PCTEC_HUB", "rh_colaboradores")).rejects.toBeInstanceOf(
      IdentityExternalReferenceBindingNotFoundError
    );
  });

  it("Identity desconhecida tem comportamento EXPLÍCITO: mesma recusa de 'sem vínculo', nunca um oráculo de existência", async () => {
    const { service } = montar();
    const semVinculo = service.execute(IDENTIDADE, "PCTEC_HUB", "rh_colaboradores");
    const inexistente = service.execute(OUTRA_IDENTIDADE, "PCTEC_HUB", "rh_colaboradores");

    await expect(semVinculo).rejects.toMatchObject({ code: "IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND" });
    await expect(inexistente).rejects.toMatchObject({ code: "IDENTITY_EXTERNAL_REFERENCE_NOT_FOUND" });
  });

  it("identityPublicId malformado é recusado pelo Value Object, nunca chega ao repositório", async () => {
    const { service } = montar();

    await expect(service.execute("nao-e-um-uuid", "PCTEC_HUB", "rh_colaboradores")).rejects.toBeInstanceOf(
      InvalidPublicIdError
    );
  });

  it("DUAS referências ACTIVE para a mesma chave são RECUSADAS, nunca resolvidas por escolha", async () => {
    const { repositorio, service } = montar();
    await repositorio.insert(
      ativa({ identityPublicId: IDENTIDADE, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 10 })
    );
    await repositorio.insert(
      ativa({ identityPublicId: IDENTIDADE, systemCode: "PCTEC_HUB", entityType: "rh_colaboradores", legacyId: 20 })
    );

    await expect(service.execute(IDENTIDADE, "PCTEC_HUB", "rh_colaboradores")).rejects.toBeInstanceOf(
      IdentityExternalReferenceBindingAmbiguousError
    );
  });
});
