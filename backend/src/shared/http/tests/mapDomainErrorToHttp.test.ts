import { describe, it, expect } from "vitest";
import { mapDomainErrorToHttp, isDomainError } from "../mapDomainErrorToHttp.js";
import { IdentityNotFoundError } from "../../../modules/identity/domain/errors/IdentityErrors.js";
import { InvalidPublicIdError } from "../../../modules/identity/domain/value-objects/PublicId.js";
import { IdentityEmailAlreadyExistsError, IdentityVersionConflictError } from "../../../modules/identity/domain/errors/IdentityErrors.js";
import { ActorRequiredError } from "../../../modules/identity/domain/value-objects/ActorPublicId.js";

describe("mapDomainErrorToHttp", () => {
  it("IDENTITY_NOT_FOUND → 404 (override explícito, conforme docs/03-dominio/IDENTITY-DOMAIN-ERRORS.md)", () => {
    const mapped = mapDomainErrorToHttp(new IdentityNotFoundError("11111111-1111-1111-1111-111111111111"));
    expect(mapped.status).toBe(404);
    expect(mapped.code).toBe("IDENTITY_NOT_FOUND");
  });

  it("IDENTITY_PUBLIC_ID_INVALID → 422 (gap do catálogo — aplica o mesmo padrão de erros VALIDATION de formato já documentados)", () => {
    const mapped = mapDomainErrorToHttp(new InvalidPublicIdError());
    expect(mapped.status).toBe(422);
    expect(mapped.code).toBe("IDENTITY_PUBLIC_ID_INVALID");
  });

  it("erro CONFLICT sem override específico → 409 (fallback por classificação)", () => {
    const mapped = mapDomainErrorToHttp(new IdentityEmailAlreadyExistsError());
    expect(mapped.status).toBe(409);
  });

  it("IDENTITY_VERSION_CONFLICT → 409 (classificação CONFLICT)", () => {
    const mapped = mapDomainErrorToHttp(new IdentityVersionConflictError(1, 2));
    expect(mapped.status).toBe(409);
  });

  it("erro VALIDATION genérico sem override → 422 (fallback por classificação, nunca 400)", () => {
    const mapped = mapDomainErrorToHttp(new ActorRequiredError());
    expect(mapped.status).toBe(422);
  });

  it("nunca inclui detalhe interno na mensagem mapeada — repassa só o que o próprio DomainError já expõe (mensagem de domínio, nunca SQL/stack)", () => {
    const error = new IdentityNotFoundError("11111111-1111-1111-1111-111111111111");
    const mapped = mapDomainErrorToHttp(error);
    expect(mapped.message).toBe(error.message);
    expect(mapped.message).not.toMatch(/SELECT|FROM|mysql|stack/i);
  });
});

describe("isDomainError", () => {
  it("identifica corretamente um DomainError", () => {
    expect(isDomainError(new IdentityNotFoundError("x"))).toBe(true);
  });

  it("rejeita um Error comum (ex.: erro de driver mysql2, bug inesperado)", () => {
    expect(isDomainError(new Error("ER_PARSE_ERROR: alguma coisa"))).toBe(false);
    expect(isDomainError("uma string qualquer")).toBe(false);
    expect(isDomainError(undefined)).toBe(false);
  });
});
