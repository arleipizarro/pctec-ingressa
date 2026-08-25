import { describe, expect, it } from "vitest";
import { Identity } from "../../identity/domain/Identity.js";
import type { IdentityRepository } from "../../identity/domain/IdentityRepository.js";
import { GetMyApplicationsService, type GrantedApplicationRow } from "../application/GetMyApplicationsService.js";

const IDENTIDADE = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const AGORA = new Date("2026-01-01T12:00:00.000Z");

class FakeIdentityRepository implements IdentityRepository {
  public constructor(private readonly identity: Identity | undefined) {}
  public async findByPublicId(): Promise<Identity | undefined> {
    return this.identity;
  }
  public async findByNormalizedEmail(): Promise<undefined> {
    return undefined;
  }
  public async existsByNormalizedEmail(): Promise<boolean> {
    return false;
  }
  public async existsByNormalizedCpf(): Promise<boolean> {
    return false;
  }
  public async countAll(): Promise<number> {
    return 1;
  }
  public async insert(): Promise<void> {}
  public async update(): Promise<void> {}
}

function identidade(): Identity {
  return Identity.reconstitute({
    internalId: 1,
    publicId: IDENTIDADE,
    type: "HUMAN",
    fullName: "Administrador Sintetico",
    email: "admin@example.invalid",
    emailNormalized: "admin@example.invalid",
    status: "ACTIVE",
    loginEnabled: true,
    version: 1,
    createdAt: AGORA,
    updatedAt: AGORA
  });
}

function montar(linhas: readonly GrantedApplicationRow[], destinos: Record<string, string> = {}): GetMyApplicationsService {
  return new GetMyApplicationsService(
    new FakeIdentityRepository(identidade()),
    { listGrantedApplications: async () => linhas },
    destinos
  );
}

describe("painel Meus aplicativos", () => {
  it("monta um card por acesso concedido, com nome e perfil", async () => {
    const service = montar(
      [
        { applicationCode: "PCTEC_INGRESSA", applicationName: "PCTEC Ingressa", accessProfile: "ADMIN" },
        { applicationCode: "PCTEC_PORTAL", applicationName: "PCTEC Portal", accessProfile: "USER" }
      ],
      { PCTEC_INGRESSA: "/admin", PCTEC_PORTAL: "https://portal.example.invalid/start" }
    );

    const resultado = await service.execute(IDENTIDADE);

    expect(resultado.identity).toEqual({ publicId: IDENTIDADE, fullName: "Administrador Sintetico" });
    expect(resultado.applications).toEqual([
      { code: "PCTEC_INGRESSA", name: "PCTEC Ingressa", profile: "ADMIN", launchUrl: "/admin" },
      { code: "PCTEC_PORTAL", name: "PCTEC Portal", profile: "USER", launchUrl: "https://portal.example.invalid/start" }
    ]);
  });

  it("sem acesso concedido, não há card algum — e isso não é erro", async () => {
    const resultado = await montar([]).execute(IDENTIDADE);
    expect(resultado.applications).toEqual([]);
  });

  it("acesso concedido sem destino configurado vira card sem launchUrl, nunca card ausente", async () => {
    const resultado = await montar([
      { applicationCode: "PCTEC_HELPDESK", applicationName: "PCTEC Helpdesk", accessProfile: "USER" }
    ]).execute(IDENTIDADE);

    expect(resultado.applications).toEqual([
      { code: "PCTEC_HELPDESK", name: "PCTEC Helpdesk", profile: "USER", launchUrl: null }
    ]);
  });

  it("o payload não carrega e-mail, status, memberships nem qualquer segredo", async () => {
    const resultado = await montar([
      { applicationCode: "PCTEC_PORTAL", applicationName: "PCTEC Portal", accessProfile: "USER" }
    ]).execute(IDENTIDADE);

    const serializado = JSON.stringify(resultado);
    expect(serializado).not.toContain("@example.invalid");
    expect(serializado).not.toContain("ACTIVE");
    expect(serializado).not.toContain("organizations");
  });
});
