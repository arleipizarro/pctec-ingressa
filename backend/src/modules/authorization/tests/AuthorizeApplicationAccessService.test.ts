import { describe, it, expect } from "vitest";
import { AuthorizeApplicationAccessService } from "../application/AuthorizeApplicationAccessService.js";
import { ApplicationAccessDeniedError } from "../domain/errors/AuthorizationErrors.js";
import { Application } from "../../application/domain/Application.js";
import { ApplicationAccess } from "../../application/domain/ApplicationAccess.js";
import { FakeApplicationRepository, FakeApplicationAccessRepository } from "./FakeAuthorizationRepositories.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const OTHER_IDENTITY_PUBLIC_ID = "77777777-7777-7777-7777-777777777777";
const APPLICATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001";
const OTHER_APPLICATION_PUBLIC_ID = "88888888-8888-8888-8888-888888888888";
const APPLICATION_CODE = "PCTEC_INGRESSA";
const OTHER_APPLICATION_CODE = "OUTRA_APP";

function buildActiveApplication(overrides: { status?: string; publicId?: string; code?: string } = {}): Application {
  return Application.reconstitute({
    internalId: 1,
    publicId: overrides.publicId ?? APPLICATION_PUBLIC_ID,
    code: overrides.code ?? APPLICATION_CODE,
    name: "PCTEC Ingressa",
    status: overrides.status ?? "ACTIVE",
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  });
}

function buildGrantedAdminAccess(
  overrides: { status?: string; accessProfile?: string; identityPublicId?: string; applicationPublicId?: string } = {}
): ApplicationAccess {
  return ApplicationAccess.reconstitute({
    internalId: 1,
    publicId: "55555555-5555-5555-5555-555555555555",
    identityPublicId: overrides.identityPublicId ?? IDENTITY_PUBLIC_ID,
    applicationPublicId: overrides.applicationPublicId ?? APPLICATION_PUBLIC_ID,
    accessProfile: overrides.accessProfile ?? "ADMIN",
    status: overrides.status ?? "GRANTED",
    grantedAt: new Date("2026-01-01T00:00:00Z"),
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  });
}

function createHarness() {
  const applicationRepository = new FakeApplicationRepository();
  const applicationAccessRepository = new FakeApplicationAccessRepository();
  const service = new AuthorizeApplicationAccessService(applicationRepository, applicationAccessRepository);
  return { applicationRepository, applicationAccessRepository, service };
}

describe("AuthorizeApplicationAccessService - 1-8. cada causa de falha -> ApplicationAccessDeniedError (403)", () => {
  it("1. Application inexistente -> 403, reason=APPLICATION_NOT_FOUND", async () => {
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.execute({
        identityPublicId: IDENTITY_PUBLIC_ID,
        applicationCode: APPLICATION_CODE,
        requiredProfile: "ADMIN"
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApplicationAccessDeniedError);
    expect((caught as ApplicationAccessDeniedError).reason).toBe("APPLICATION_NOT_FOUND");
    expect((caught as ApplicationAccessDeniedError).classification).toBe("AUTHORIZATION");
  });

  it("2. Application inativa -> 403, reason=APPLICATION_NOT_ACTIVE, mesmo com ApplicationAccess GRANTED existente", async () => {
    const { applicationRepository, applicationAccessRepository, service } = createHarness();
    applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication({ status: "INACTIVE" }));
    applicationAccessRepository.byIdentityAndApplication.set(
      `${IDENTITY_PUBLIC_ID}:${APPLICATION_PUBLIC_ID}`,
      buildGrantedAdminAccess()
    );

    let caught: unknown;
    try {
      await service.execute({
        identityPublicId: IDENTITY_PUBLIC_ID,
        applicationCode: APPLICATION_CODE,
        requiredProfile: "ADMIN"
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as ApplicationAccessDeniedError).reason).toBe("APPLICATION_NOT_ACTIVE");
  });

  it("3. Access inexistente -> 403, reason=ACCESS_NOT_FOUND", async () => {
    const { applicationRepository, service } = createHarness();
    applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication());

    let caught: unknown;
    try {
      await service.execute({
        identityPublicId: IDENTITY_PUBLIC_ID,
        applicationCode: APPLICATION_CODE,
        requiredProfile: "ADMIN"
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as ApplicationAccessDeniedError).reason).toBe("ACCESS_NOT_FOUND");
  });

  it("4. Access REVOKED -> 403, reason=ACCESS_NOT_GRANTED", async () => {
    const { applicationRepository, applicationAccessRepository, service } = createHarness();
    applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication());
    applicationAccessRepository.byIdentityAndApplication.set(
      `${IDENTITY_PUBLIC_ID}:${APPLICATION_PUBLIC_ID}`,
      buildGrantedAdminAccess({ status: "REVOKED" })
    );

    let caught: unknown;
    try {
      await service.execute({
        identityPublicId: IDENTITY_PUBLIC_ID,
        applicationCode: APPLICATION_CODE,
        requiredProfile: "ADMIN"
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as ApplicationAccessDeniedError).reason).toBe("ACCESS_NOT_GRANTED");
  });

  it("5. requiredProfile inválido/desconhecido nunca é silenciosamente aceito", async () => {
    const { applicationRepository, applicationAccessRepository, service } = createHarness();
    applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication());
    applicationAccessRepository.byIdentityAndApplication.set(
      `${IDENTITY_PUBLIC_ID}:${APPLICATION_PUBLIC_ID}`,
      buildGrantedAdminAccess({ accessProfile: "ADMIN" })
    );

    await expect(
      service.execute({
        identityPublicId: IDENTITY_PUBLIC_ID,
        applicationCode: APPLICATION_CODE,
        requiredProfile: "SUPERADMIN"
      })
    ).rejects.toThrow();
  });

  it("6. Access GRANTED ADMIN -> autorizado, retorno mínimo correto", async () => {
    const { applicationRepository, applicationAccessRepository, service } = createHarness();
    applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication());
    applicationAccessRepository.byIdentityAndApplication.set(
      `${IDENTITY_PUBLIC_ID}:${APPLICATION_PUBLIC_ID}`,
      buildGrantedAdminAccess()
    );

    const result = await service.execute({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationCode: APPLICATION_CODE,
      requiredProfile: "ADMIN"
    });

    expect(result).toEqual({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationPublicId: APPLICATION_PUBLIC_ID,
      applicationCode: APPLICATION_CODE,
      accessProfile: "ADMIN"
    });
  });

  it("10. retorno mínimo - nunca contém roles, permissions, ou campos extras", async () => {
    const { applicationRepository, applicationAccessRepository, service } = createHarness();
    applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication());
    applicationAccessRepository.byIdentityAndApplication.set(
      `${IDENTITY_PUBLIC_ID}:${APPLICATION_PUBLIC_ID}`,
      buildGrantedAdminAccess()
    );

    const result = await service.execute({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationCode: APPLICATION_CODE,
      requiredProfile: "ADMIN"
    });

    expect(Object.keys(result).sort()).toEqual(
      ["identityPublicId", "applicationPublicId", "applicationCode", "accessProfile"].sort()
    );
    expect(result).not.toHaveProperty("roles");
    expect(result).not.toHaveProperty("permissions");
    expect(result).not.toHaveProperty("session");
  });

  it("7. [SEGURANCA] Identity diferente da que possui o ApplicationAccess -> 403", async () => {
    const { applicationRepository, applicationAccessRepository, service } = createHarness();
    applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication());
    applicationAccessRepository.byIdentityAndApplication.set(
      `${OTHER_IDENTITY_PUBLIC_ID}:${APPLICATION_PUBLIC_ID}`,
      buildGrantedAdminAccess({ identityPublicId: OTHER_IDENTITY_PUBLIC_ID })
    );

    let caught: unknown;
    try {
      await service.execute({
        identityPublicId: IDENTITY_PUBLIC_ID,
        applicationCode: APPLICATION_CODE,
        requiredProfile: "ADMIN"
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApplicationAccessDeniedError);
    expect((caught as ApplicationAccessDeniedError).reason).toBe("ACCESS_NOT_FOUND");
  });

  it("8. [CONFUSAO ENTRE APPS] Identity tem ADMIN para aplicacao A, rota exige aplicacao B -> 403", async () => {
    const { applicationRepository, applicationAccessRepository, service } = createHarness();
    applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication());
    applicationRepository.byCode.set(
      OTHER_APPLICATION_CODE,
      buildActiveApplication({ publicId: OTHER_APPLICATION_PUBLIC_ID, code: OTHER_APPLICATION_CODE })
    );
    applicationAccessRepository.byIdentityAndApplication.set(
      `${IDENTITY_PUBLIC_ID}:${OTHER_APPLICATION_PUBLIC_ID}`,
      buildGrantedAdminAccess({ applicationPublicId: OTHER_APPLICATION_PUBLIC_ID })
    );

    let caught: unknown;
    try {
      await service.execute({
        identityPublicId: IDENTITY_PUBLIC_ID,
        applicationCode: APPLICATION_CODE,
        requiredProfile: "ADMIN"
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApplicationAccessDeniedError);
    expect((caught as ApplicationAccessDeniedError).reason).toBe("ACCESS_NOT_FOUND");
  });

  it("9. nenhum reason interno vaza na mensagem externa, em nenhum cenario", async () => {
    const scenarios: Array<() => Promise<void>> = [
      async () => {
        const { service } = createHarness();
        await service.execute({
          identityPublicId: IDENTITY_PUBLIC_ID,
          applicationCode: APPLICATION_CODE,
          requiredProfile: "ADMIN"
        });
      },
      async () => {
        const { applicationRepository, service } = createHarness();
        applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication({ status: "INACTIVE" }));
        await service.execute({
          identityPublicId: IDENTITY_PUBLIC_ID,
          applicationCode: APPLICATION_CODE,
          requiredProfile: "ADMIN"
        });
      },
      async () => {
        const { applicationRepository, applicationAccessRepository, service } = createHarness();
        applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication());
        applicationAccessRepository.byIdentityAndApplication.set(
          `${IDENTITY_PUBLIC_ID}:${APPLICATION_PUBLIC_ID}`,
          buildGrantedAdminAccess({ status: "REVOKED" })
        );
        await service.execute({
          identityPublicId: IDENTITY_PUBLIC_ID,
          applicationCode: APPLICATION_CODE,
          requiredProfile: "ADMIN"
        });
      }
    ];

    for (const scenario of scenarios) {
      let caught: unknown;
      try {
        await scenario();
      } catch (error) {
        caught = error;
      }
      const error = caught as ApplicationAccessDeniedError;
      expect(error.message).not.toContain(error.reason);
      expect(error.message).toBe("Acesso negado a esta aplicação.");
      expect(error.code).toBe("APPLICATION_ACCESS_DENIED");
    }
  });
});

describe("AuthorizeApplicationAccessService - resolve por CODE, nunca UUID hardcoded", () => {
  it("consulta o ApplicationRepository por codigo, nao por publicId direto", async () => {
    const { applicationRepository, applicationAccessRepository, service } = createHarness();
    applicationRepository.byCode.set(APPLICATION_CODE, buildActiveApplication());
    applicationAccessRepository.byIdentityAndApplication.set(
      `${IDENTITY_PUBLIC_ID}:${APPLICATION_PUBLIC_ID}`,
      buildGrantedAdminAccess()
    );

    await service.execute({
      identityPublicId: IDENTITY_PUBLIC_ID,
      applicationCode: APPLICATION_CODE,
      requiredProfile: "ADMIN"
    });

    expect(applicationRepository.findByCodeCalls).toEqual([APPLICATION_CODE]);
  });
});

describe("AuthorizeApplicationAccessService - nunca 401, sempre 403", () => {
  it("todas as falhas usam classification=AUTHORIZATION (403), nunca AUTHENTICATION (401)", async () => {
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.execute({
        identityPublicId: IDENTITY_PUBLIC_ID,
        applicationCode: APPLICATION_CODE,
        requiredProfile: "ADMIN"
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as ApplicationAccessDeniedError).classification).toBe("AUTHORIZATION");
    expect((caught as ApplicationAccessDeniedError).classification).not.toBe("AUTHENTICATION");
  });
});
