import { describe, expect, it, vi } from "vitest";
import { RevokeApplicationAccessService } from "../application/RevokeApplicationAccessService.js";
import { ApplicationAccess } from "../domain/ApplicationAccess.js";
import {
  ApplicationAccessNotFoundError,
  ApplicationAccessNotGrantedError,
  ApplicationAccessVersionConflictError
} from "../domain/errors/ApplicationErrors.js";

const ACESSO = "4d982417-1cf1-4f21-ad5e-bfbf6c7fd3c1";
const IDENTIDADE = "8aceafb7-5ff7-4043-947b-85f035757e9e";
const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";

function acessoConcedido(status: "GRANTED" | "REVOKED" = "GRANTED", version = 1): ApplicationAccess {
  return ApplicationAccess.reconstitute({
    internalId: 1,
    publicId: ACESSO,
    identityPublicId: IDENTIDADE,
    applicationPublicId: "0b13f6f0-8f3a-4a1e-9c2d-000000000003",
    accessProfile: "USER",
    status,
    grantedAt: new Date("2026-08-25T00:00:00.000Z"),
    grantedByIdentityPublicId: ADMIN,
    revokedAt: status === "REVOKED" ? new Date("2026-08-25T01:00:00.000Z") : undefined,
    revokedByIdentityPublicId: status === "REVOKED" ? ADMIN : undefined,
    version,
    createdAt: new Date("2026-08-25T00:00:00.000Z"),
    updatedAt: new Date("2026-08-25T00:00:00.000Z")
  });
}

function montar(acesso: ApplicationAccess | undefined, version = 1) {
  const escritas: { access: ApplicationAccess; expectedVersion: number }[] = [];
  const auditoria: unknown[][] = [];
  const service = new RevokeApplicationAccessService(
    { runInTransaction: async (w: (c: unknown) => Promise<unknown>) => w({}) } as never,
    () => ({
      findByPublicId: async () => acesso,
      update: async (access: ApplicationAccess, expectedVersion: number) => {
        escritas.push({ access, expectedVersion });
      }
    }) as never,
    () => ({ insertMany: async (e: unknown[]) => auditoria.push(e) }) as never
  );
  void version;
  return { service, escritas, auditoria };
}

describe("revogação de ApplicationAccess", () => {
  it("revoga, audita e persiste com a versão original como trava", async () => {
    const { service, escritas, auditoria } = montar(acessoConcedido());
    const resultado = await service.execute({
      applicationAccessPublicId: ACESSO,
      revokedByIdentityPublicId: ADMIN,
      expectedVersion: 1
    });

    expect(resultado.status).toBe("REVOKED");
    expect(resultado.version).toBe(2);
    expect(escritas[0]?.expectedVersion).toBe(1);
    expect(auditoria[0]).toHaveLength(1);
  });

  it("nunca apaga: o acesso permanece com carimbo de quem revogou", async () => {
    const acesso = acessoConcedido();
    const { service } = montar(acesso);
    await service.execute({ applicationAccessPublicId: ACESSO, revokedByIdentityPublicId: ADMIN, expectedVersion: 1 });

    expect(acesso.getStatus()).toBe("REVOKED");
    expect(acesso.getRevokedByIdentityPublicId()).toBe(ADMIN);
    expect(acesso.getRevokedAt()).toBeInstanceOf(Date);
    expect(acesso.getGrantedAt()).toBeInstanceOf(Date);
  });

  it("404 quando o acesso não existe", async () => {
    const { service } = montar(undefined);
    await expect(
      service.execute({ applicationAccessPublicId: ACESSO, revokedByIdentityPublicId: ADMIN, expectedVersion: 1 })
    ).rejects.toThrow(ApplicationAccessNotFoundError);
  });

  it("409 ao revogar o que já está revogado — nunca no-op silencioso", async () => {
    const { service, escritas } = montar(acessoConcedido("REVOKED"));
    await expect(
      service.execute({ applicationAccessPublicId: ACESSO, revokedByIdentityPublicId: ADMIN, expectedVersion: 1 })
    ).rejects.toThrow(ApplicationAccessNotGrantedError);
    expect(escritas).toEqual([]);
  });

  it("409 quando a versão informada não é a atual — escrita concorrente", async () => {
    const { service, escritas } = montar(acessoConcedido("GRANTED", 5));
    await expect(
      service.execute({ applicationAccessPublicId: ACESSO, revokedByIdentityPublicId: ADMIN, expectedVersion: 1 })
    ).rejects.toThrow(ApplicationAccessVersionConflictError);
    expect(escritas).toEqual([]);
  });

  it("o evento de auditoria não carrega dado pessoal", async () => {
    const { service, auditoria } = montar(acessoConcedido());
    await service.execute({ applicationAccessPublicId: ACESSO, revokedByIdentityPublicId: ADMIN, expectedVersion: 1 });

    const serializado = JSON.stringify(auditoria).toLowerCase();
    for (const proibido of ["@", "password", "senha", "hash", "token"]) {
      expect(serializado).not.toContain(proibido);
    }
  });
});
