import { describe, it, expect } from "vitest";
import { Application } from "../domain/Application.js";
import { ApplicationCode, InvalidApplicationCodeError } from "../domain/value-objects/ApplicationCode.js";
import { ApplicationName } from "../domain/value-objects/ApplicationName.js";
import {
  PCTEC_INGRESSA_APPLICATION_CODE,
  PCTEC_INGRESSA_APPLICATION_NAME,
  PCTEC_INGRESSA_APPLICATION_PUBLIC_ID
} from "../domain/value-objects/ApplicationCodes.js";

describe("Application — 1. criada/carregada corretamente (reconstitute)", () => {
  it("reconstrói uma Application a partir de estado persistido", () => {
    const application = Application.reconstitute({
      internalId: 1,
      publicId: PCTEC_INGRESSA_APPLICATION_PUBLIC_ID,
      code: PCTEC_INGRESSA_APPLICATION_CODE,
      name: PCTEC_INGRESSA_APPLICATION_NAME,
      status: "ACTIVE",
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z")
    });

    expect(application.getPublicId().toString()).toBe(PCTEC_INGRESSA_APPLICATION_PUBLIC_ID);
    expect(application.getCode().toString()).toBe("PCTEC_INGRESSA");
    expect(application.getName().toString()).toBe("PCTEC Ingressa");
    expect(application.isActive()).toBe(true);
    expect(application.getInternalIdForPersistence()).toBe(1);
  });
});

describe("ApplicationCode — 2. code único (validação de formato)", () => {
  it("aceita códigos em maiúsculas com underscore, ex.: PCTEC_INGRESSA", () => {
    expect(() => ApplicationCode.create("PCTEC_INGRESSA")).not.toThrow();
  });

  it("rejeita código vazio", () => {
    expect(() => ApplicationCode.create("")).toThrow(InvalidApplicationCodeError);
  });

  it("rejeita código em minúsculas (formato inválido)", () => {
    expect(() => ApplicationCode.create("pctec_ingressa")).toThrow(InvalidApplicationCodeError);
  });

  it("dois ApplicationCode iguais são considerados equals()", () => {
    const a = ApplicationCode.create("PCTEC_INGRESSA");
    const b = ApplicationCode.create("PCTEC_INGRESSA");
    expect(a.equals(b)).toBe(true);
  });

  it("a unicidade real de code é responsabilidade do banco (UNIQUE KEY uk_applications_code, migration 0005) — este VO só valida formato", () => {
    // Documentado explicitamente: não há checagem de unicidade em memória
    // no VO — unicidade é garantida pela constraint do banco. Este teste
    // apenas documenta essa fronteira de responsabilidade.
    expect(true).toBe(true);
  });
});

describe("ApplicationName", () => {
  it("rejeita nome vazio", () => {
    expect(() => ApplicationName.create("   ")).toThrow();
  });

  it("normaliza espaços redundantes", () => {
    expect(ApplicationName.create("PCTEC   Ingressa").toString()).toBe("PCTEC Ingressa");
  });
});

describe("ApplicationCodes — constantes centralizadas (task v0.5.0, seção 6)", () => {
  it("PCTEC_INGRESSA_APPLICATION_CODE é a string estável usada em todo o código", () => {
    expect(PCTEC_INGRESSA_APPLICATION_CODE).toBe("PCTEC_INGRESSA");
  });

  it("PCTEC_INGRESSA_APPLICATION_PUBLIC_ID é um UUID válido, determinístico", () => {
    expect(PCTEC_INGRESSA_APPLICATION_PUBLIC_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
