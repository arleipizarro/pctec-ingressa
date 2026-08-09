import { describe, it, expect } from "vitest";
import { Credential, CREDENTIAL_BOOTSTRAP_EVENT_ACTOR_MARKER } from "../domain/Credential.js";
import { CredentialType, CredentialTypeNotSupportedError } from "../domain/value-objects/CredentialType.js";
import { CredentialStatus } from "../domain/value-objects/CredentialStatus.js";
import { PasswordHash, InvalidPasswordHashError } from "../domain/value-objects/PasswordHash.js";
import { PlainPassword, CredentialPasswordPolicyViolationError } from "../domain/value-objects/PlainPassword.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000070";
const VALID_PHC = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHR2YWx1ZQ$c29tZWhhc2h2YWx1ZTEyMzQ1Ng";

function buildPasswordHash(): PasswordHash {
  return PasswordHash.fromPhcString(VALID_PHC);
}

describe("Credential.createFoundational", () => {
  it("1. cria a credencial fundacional com sucesso", () => {
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: buildPasswordHash(),
      correlationId: CORRELATION_ID
    });

    expect(credential).toBeInstanceOf(Credential);
  });

  it("3. type é sempre LOCAL_PASSWORD", () => {
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: buildPasswordHash(),
      correlationId: CORRELATION_ID
    });

    expect(credential.getType().toString()).toBe("LOCAL_PASSWORD");
  });

  it("4. status inicial é ACTIVE", () => {
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: buildPasswordHash(),
      correlationId: CORRELATION_ID
    });

    expect(credential.getStatus().toString()).toBe("ACTIVE");
    expect(credential.isActive()).toBe(true);
  });

  it("5. publicId é gerado (UUID válido)", () => {
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: buildPasswordHash(),
      correlationId: CORRELATION_ID
    });

    expect(credential.getPublicId().toString()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("6. identityPublicId é preservado corretamente", () => {
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: buildPasswordHash(),
      correlationId: CORRELATION_ID
    });

    expect(credential.getIdentityPublicId()).toBe(IDENTITY_PUBLIC_ID);
  });

  it("version nasce em 1", () => {
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: buildPasswordHash(),
      correlationId: CORRELATION_ID
    });

    expect(credential.getVersion()).toBe(1);
  });

  it("26. gera o evento credential.created com actor BOOTSTRAP", () => {
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: buildPasswordHash(),
      correlationId: CORRELATION_ID
    });
    const [event] = credential.pullDomainEvents();

    expect(event?.eventType).toBe("credential.created");
    expect(event?.actorPublicId).toBe("BOOTSTRAP");
    expect(event?.actorPublicId).toBe(CREDENTIAL_BOOTSTRAP_EVENT_ACTOR_MARKER);
  });

  it("30. o payload do evento não contém senha, hash, salt ou PHC", () => {
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: buildPasswordHash(),
      correlationId: CORRELATION_ID
    });
    const [event] = credential.pullDomainEvents();
    const serialized = JSON.stringify(event?.payload);

    expect(event?.payload).not.toHaveProperty("passwordHash");
    expect(event?.payload).not.toHaveProperty("password");
    expect(event?.payload).not.toHaveProperty("salt");
    expect(event?.payload).not.toHaveProperty("phc");
    expect(serialized).not.toContain("argon2id");
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual(
      ["credentialPublicId", "identityPublicId", "type"].sort()
    );
  });

  it("internalId nunca é exposto por getter público comum", () => {
    const credential = Credential.createFoundational({
      identityPublicId: IDENTITY_PUBLIC_ID,
      passwordHash: buildPasswordHash(),
      correlationId: CORRELATION_ID
    });

    expect(credential.getInternalIdForPersistence()).toBeUndefined();
    credential.assignInternalIdFromPersistence(9);
    expect(credential.getInternalIdForPersistence()).toBe(9);
  });
});

describe("Credential.reconstitute", () => {
  it("2. reconstrói a partir de estado persistido, sem gerar eventos", () => {
    const credential = Credential.reconstitute({
      internalId: 3,
      publicId: "22222222-2222-2222-2222-222222222222",
      identityPublicId: IDENTITY_PUBLIC_ID,
      type: "LOCAL_PASSWORD",
      passwordHash: VALID_PHC,
      status: "ACTIVE",
      lastAuthenticatedAt: undefined,
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z")
    });

    expect(credential.getStatus().toString()).toBe("ACTIVE");
    expect(credential.pullDomainEvents()).toHaveLength(0);
  });
});

describe("CredentialType", () => {
  it("LOCAL_PASSWORD é válido", () => {
    expect(() => CredentialType.create("LOCAL_PASSWORD")).not.toThrow();
    expect(CredentialType.localPassword().toString()).toBe("LOCAL_PASSWORD");
  });

  it("qualquer outro valor é rejeitado", () => {
    expect(() => CredentialType.create("PASSWORD")).toThrow(CredentialTypeNotSupportedError);
    expect(() => CredentialType.create("MICROSOFT_ENTRA")).toThrow(CredentialTypeNotSupportedError);
  });
});

describe("CredentialStatus", () => {
  it("ACTIVE é válido", () => {
    expect(() => CredentialStatus.fromString("ACTIVE")).not.toThrow();
    expect(CredentialStatus.active().toString()).toBe("ACTIVE");
  });

  it("REVOKED é válido", () => {
    expect(() => CredentialStatus.fromString("REVOKED")).not.toThrow();
  });

  it("PENDING/LOCKED/DISABLED são rejeitados — não são valores de status", () => {
    expect(() => CredentialStatus.fromString("PENDING")).toThrow();
    expect(() => CredentialStatus.fromString("LOCKED")).toThrow();
    expect(() => CredentialStatus.fromString("DISABLED")).toThrow();
  });
});

describe("PasswordHash — 7/9. PHC nunca é plain text, formato validado", () => {
  it("aceita uma string PHC sintaticamente válida", () => {
    expect(() => PasswordHash.fromPhcString(VALID_PHC)).not.toThrow();
  });

  it("rejeita uma senha em texto puro (não é formato PHC)", () => {
    expect(() => PasswordHash.fromPhcString("minhasenha12345")).toThrow(InvalidPasswordHashError);
  });

  it("rejeita string vazia", () => {
    expect(() => PasswordHash.fromPhcString("")).toThrow(InvalidPasswordHashError);
  });

  it("a mensagem de erro nunca ecoa o valor recebido", () => {
    let caught: unknown;
    try {
      PasswordHash.fromPhcString("valor-suspeito-nao-deveria-aparecer");
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).not.toContain("valor-suspeito-nao-deveria-aparecer");
  });
});

describe("PlainPassword — 10/41. política de senha e confirmação", () => {
  it("aceita senha que cumpre a política mínima (comprimento >= 12)", () => {
    expect(() => PlainPassword.create("senha-valida-123")).not.toThrow();
  });

  it("rejeita senha abaixo do comprimento mínimo", () => {
    expect(() => PlainPassword.create("curta12")).toThrow(CredentialPasswordPolicyViolationError);
  });

  it("rejeita senha na blacklist de senhas comprometidas", () => {
    expect(() => PlainPassword.create("password123456")).toThrow(CredentialPasswordPolicyViolationError);
  });

  it("41. rejeita quando a confirmação diverge da senha", () => {
    expect(() => PlainPassword.createWithConfirmation("senha-valida-123", "outra-senha-456")).toThrow(
      CredentialPasswordPolicyViolationError
    );
  });

  it("aceita quando a confirmação é idêntica à senha", () => {
    expect(() => PlainPassword.createWithConfirmation("senha-valida-123", "senha-valida-123")).not.toThrow();
  });

  it("a mensagem de erro de política nunca ecoa o valor da senha", () => {
    let caught: unknown;
    try {
      PlainPassword.create("curta");
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).not.toContain("curta");
  });

  it("revealForHashing() é o único ponto de acesso ao valor bruto — não aparece em JSON.stringify nem console-like inspection", () => {
    const password = PlainPassword.create("senha-valida-123");
    expect(JSON.stringify(password)).not.toContain("senha-valida-123");
    expect(Object.keys(password)).not.toContain("value");
    expect(password.revealForHashing()).toBe("senha-valida-123");
  });
});
