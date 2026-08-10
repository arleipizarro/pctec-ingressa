import { describe, it, expect } from "vitest";
import { AuthenticateIdentityService, type PasswordVerifier } from "../application/AuthenticateIdentityService.js";
import { AuthenticationFailedError } from "../domain/errors/AuthenticationErrors.js";
import { Identity } from "../../identity/domain/Identity.js";
import { Credential } from "../domain/Credential.js";
import { PasswordHash } from "../domain/value-objects/PasswordHash.js";
import { DUMMY_PASSWORD_HASH } from "../infrastructure/hashing/DummyPasswordHash.js";
import { FakeAuthIdentityRepository, FakeAuthCredentialRepository } from "./FakeAuthRepositories.js";

const IDENTITY_PUBLIC_ID = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const NORMALIZED_EMAIL = "pessoa@example.com";
const REAL_PASSWORD_HASH = PasswordHash.fromPhcString(
  "$argon2id$v=19$m=65536,p=4,t=3$c29tZXNhbHR2YWx1ZQ$c29tZWhhc2h2YWx1ZTEyMzQ1Ng"
);

function buildActiveIdentity(overrides: { status?: string; loginEnabled?: boolean } = {}): Identity {
  return Identity.reconstitute({
    internalId: 1,
    publicId: IDENTITY_PUBLIC_ID,
    type: "HUMAN",
    fullName: "Pessoa de Teste",
    email: "pessoa@example.com",
    emailNormalized: NORMALIZED_EMAIL,
    status: overrides.status ?? "ACTIVE",
    loginEnabled: overrides.loginEnabled ?? true,
    version: 3,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  });
}

function buildActiveCredential(overrides: { status?: string } = {}): Credential {
  return Credential.reconstitute({
    internalId: 1,
    publicId: "55555555-5555-5555-5555-555555555555",
    identityPublicId: IDENTITY_PUBLIC_ID,
    type: "LOCAL_PASSWORD",
    passwordHash: REAL_PASSWORD_HASH.toString(),
    status: overrides.status ?? "ACTIVE",
    lastAuthenticatedAt: undefined,
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  });
}

/** Spy de PasswordVerifier — nunca chama Argon2id real. Rastreia cada chamada (senha + hash comparado). */
class SpyPasswordVerifier implements PasswordVerifier {
  public calls: Array<{ password: string; hash: string }> = [];
  public shouldMatch = false;

  public async verify(password: { revealForHashing(): string }, hash: { toString(): string }): Promise<boolean> {
    this.calls.push({ password: password.revealForHashing(), hash: hash.toString() });
    return this.shouldMatch && hash.toString() === REAL_PASSWORD_HASH.toString();
  }
}

function createHarness() {
  const identityRepository = new FakeAuthIdentityRepository();
  const credentialRepository = new FakeAuthCredentialRepository();
  const passwordVerifier = new SpyPasswordVerifier();
  const service = new AuthenticateIdentityService(identityRepository, credentialRepository, passwordVerifier);
  return { identityRepository, credentialRepository, passwordVerifier, service };
}

describe("AuthenticateIdentityService - 6 cenarios de anti-enumeracao (todos -> AuthenticationFailedError)", () => {
  it("1. e-mail inexistente -> AuthenticationFailedError", async () => {
    const { service } = createHarness();

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "qualquer-senha-123" })).rejects.toThrow(
      AuthenticationFailedError
    );
  });

  it("2. senha errada -> AuthenticationFailedError", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
    passwordVerifier.shouldMatch = false;

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "senha-errada-123" })).rejects.toThrow(
      AuthenticationFailedError
    );
  });

  it("3. Credential inexistente -> AuthenticationFailedError", async () => {
    const { identityRepository, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "qualquer-senha-123" })).rejects.toThrow(
      AuthenticationFailedError
    );
  });

  it("4. Credential REVOKED -> AuthenticationFailedError", async () => {
    const { identityRepository, credentialRepository, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(
      IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD",
      buildActiveCredential({ status: "REVOKED" })
    );

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "qualquer-senha-123" })).rejects.toThrow(
      AuthenticationFailedError
    );
  });

  it("5. Identity nao ACTIVE -> AuthenticationFailedError", async () => {
    const { identityRepository, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity({ status: "BLOCKED" }));

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "qualquer-senha-123" })).rejects.toThrow(
      AuthenticationFailedError
    );
  });

  it("6. loginEnabled=false -> AuthenticationFailedError", async () => {
    const { identityRepository, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity({ loginEnabled: false }));

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "qualquer-senha-123" })).rejects.toThrow(
      AuthenticationFailedError
    );
  });

  it("7. todos os 6 cenarios retornam a MESMA estrutura externa (code/classification/mensagem identicos)", async () => {
    const scenarios: Array<() => Promise<void>> = [
      async () => {
        const { service } = createHarness();
        await service.execute({ email: "inexistente@example.com", password: "senha-123456789" });
      },
      async () => {
        const { identityRepository, credentialRepository, service } = createHarness();
        identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
        credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
        await service.execute({ email: NORMALIZED_EMAIL, password: "senha-errada-do-teste" });
      },
      async () => {
        const { identityRepository, service } = createHarness();
        identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
        await service.execute({ email: NORMALIZED_EMAIL, password: "senha-123456789" });
      },
      async () => {
        const { identityRepository, credentialRepository, service } = createHarness();
        identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
        credentialRepository.byIdentityAndType.set(
          IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD",
          buildActiveCredential({ status: "REVOKED" })
        );
        await service.execute({ email: NORMALIZED_EMAIL, password: "senha-123456789" });
      },
      async () => {
        const { identityRepository, service } = createHarness();
        identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity({ status: "INACTIVE" }));
        await service.execute({ email: NORMALIZED_EMAIL, password: "senha-123456789" });
      },
      async () => {
        const { identityRepository, service } = createHarness();
        identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity({ loginEnabled: false }));
        await service.execute({ email: NORMALIZED_EMAIL, password: "senha-123456789" });
      }
    ];

    const errors: AuthenticationFailedError[] = [];
    for (const scenario of scenarios) {
      try {
        await scenario();
        throw new Error("deveria ter lancado AuthenticationFailedError");
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationFailedError);
        errors.push(error as AuthenticationFailedError);
      }
    }

    const codes = new Set(errors.map((e) => e.code));
    const classifications = new Set(errors.map((e) => e.classification));
    const messages = new Set(errors.map((e) => e.message));
    expect(codes.size).toBe(1);
    expect(classifications.size).toBe(1);
    expect(messages.size).toBe(1);
    expect([...codes][0]).toBe("AUTHENTICATION_FAILED");
    expect([...classifications][0]).toBe("AUTHENTICATION");

    const reasons = new Set(errors.map((e) => e.reason));
    expect(reasons.size).toBe(6);
  });
});

describe("AuthenticateIdentityService - dummy Argon2id (mitigacao de timing)", () => {
  it("8. dummy verify e chamado mesmo quando o usuario nao existe", async () => {
    const { passwordVerifier, service } = createHarness();

    await expect(
      service.execute({ email: "usuario-que-nao-existe@example.com", password: "senha-123456789" })
    ).rejects.toThrow();

    expect(passwordVerifier.calls).toHaveLength(1);
    expect(passwordVerifier.calls[0]?.hash).toBe(DUMMY_PASSWORD_HASH.toString());
  });

  it("dummy verify e chamado quando Credential nao existe", async () => {
    const { identityRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "senha-123456789" })).rejects.toThrow();

    expect(passwordVerifier.calls).toHaveLength(1);
    expect(passwordVerifier.calls[0]?.hash).toBe(DUMMY_PASSWORD_HASH.toString());
  });

  it("dummy verify e chamado quando Identity nao esta ACTIVE", async () => {
    const { identityRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity({ status: "BLOCKED" }));

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "senha-123456789" })).rejects.toThrow();

    expect(passwordVerifier.calls).toHaveLength(1);
    expect(passwordVerifier.calls[0]?.hash).toBe(DUMMY_PASSWORD_HASH.toString());
  });

  it("caminho real (usuario/credential existentes) usa o hash REAL da Credential, nunca o dummy", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
    passwordVerifier.shouldMatch = true;

    await service.execute({ email: NORMALIZED_EMAIL, password: "senha-correta-123456" });

    expect(passwordVerifier.calls).toHaveLength(1);
    expect(passwordVerifier.calls[0]?.hash).toBe(REAL_PASSWORD_HASH.toString());
    expect(passwordVerifier.calls[0]?.hash).not.toBe(DUMMY_PASSWORD_HASH.toString());
  });
});

describe("AuthenticateIdentityService - PROVA UNIFICADA dos 6 caminhos: verifyCalls === 1, sempre, sem excecao (revisao critica, item 1)", () => {
  /**
   * Cobre EXATAMENTE os 6 cenarios da revisao critica, numa unica
   * tabela, provando que NENHUM deles tem um caminho de "return
   * imediato" que pule o Argon2id verify — mesmo que o resultado
   * externo (AuthenticationFailedError) seja identico, um caminho sem
   * verify() abriria um timing side-channel real (a preocupacao
   * central desta revisao).
   */
  const scenarios: Array<{
    name: string;
    setup: (harness: ReturnType<typeof createHarness>) => void;
    expectedHash: "dummy" | "real";
  }> = [
    { name: "1. email inexistente", setup: () => {}, expectedHash: "dummy" },
    {
      name: "2. senha incorreta",
      setup: (h) => {
        h.identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
        h.credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
        h.passwordVerifier.shouldMatch = false;
      },
      expectedHash: "real"
    },
    {
      name: "3. Credential inexistente",
      setup: (h) => {
        h.identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
      },
      expectedHash: "dummy"
    },
    {
      name: "4. Credential REVOKED",
      setup: (h) => {
        h.identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
        h.credentialRepository.byIdentityAndType.set(
          IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD",
          buildActiveCredential({ status: "REVOKED" })
        );
      },
      expectedHash: "dummy"
    },
    {
      name: "5. Identity nao ACTIVE",
      setup: (h) => {
        h.identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity({ status: "BLOCKED" }));
      },
      expectedHash: "dummy"
    },
    {
      name: "6. loginEnabled=false",
      setup: (h) => {
        h.identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity({ loginEnabled: false }));
      },
      expectedHash: "dummy"
    }
  ];

  for (const scenario of scenarios) {
    it(`${scenario.name}: exatamente 1 chamada a verify() — ${scenario.expectedHash === "dummy" ? "dummy hash" : "hash real (senha incorreta ainda precisa comparar contra o hash real)"}, nunca 0 chamadas`, async () => {
      const harness = createHarness();
      scenario.setup(harness);

      let caughtError: unknown;
      try {
        await harness.service.execute({ email: NORMALIZED_EMAIL, password: "senha-de-teste-123456" });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(AuthenticationFailedError);
      // A prova central desta revisao: NUNCA 0 chamadas (o que
      // significaria um "return imediato" sem pagar o custo do
      // Argon2id) e NUNCA mais de 1 (o que seria redundante/desperdicio,
      // e poderia por si so introduzir uma diferenca de tempo entre
      // cenarios).
      expect(harness.passwordVerifier.calls).toHaveLength(1);
      const expectedHashValue = scenario.expectedHash === "dummy" ? DUMMY_PASSWORD_HASH.toString() : REAL_PASSWORD_HASH.toString();
      expect(harness.passwordVerifier.calls[0]?.hash).toBe(expectedHashValue);
    });
  }

  it("nenhum reason interno aparece na mensagem externa do erro, em nenhum dos 6 cenarios", async () => {
    for (const scenario of scenarios) {
      const harness = createHarness();
      scenario.setup(harness);

      let caughtError: unknown;
      try {
        await harness.service.execute({ email: NORMALIZED_EMAIL, password: "senha-de-teste-123456" });
      } catch (error) {
        caughtError = error;
      }

      const error = caughtError as AuthenticationFailedError;
      // A mensagem externa (error.message) nunca contem o valor de
      // error.reason (ex.: "IDENTITY_NOT_FOUND", "CREDENTIAL_REVOKED")
      // — reason existe só como propriedade interna, nunca serializado
      // na mensagem que vira resposta HTTP.
      expect(error.message).not.toContain(error.reason);
      expect(error.message).toBe("Não foi possível autenticar com as credenciais informadas.");
    }
  });
});

describe("AuthenticateIdentityService - sucesso", () => {
  it("9. senha correta autentica com sucesso, retorna somente identityPublicId", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
    passwordVerifier.shouldMatch = true;

    const result = await service.execute({ email: NORMALIZED_EMAIL, password: "senha-correta-123456" });

    expect(result).toEqual({ identityPublicId: IDENTITY_PUBLIC_ID });
    expect(Object.keys(result)).toEqual(["identityPublicId"]);
  });

  it("normaliza o e-mail (trim + lowercase) antes de buscar", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
    passwordVerifier.shouldMatch = true;

    await service.execute({ email: "  PESSOA@EXAMPLE.COM  ", password: "senha-correta-123456" });

    expect(identityRepository.findByNormalizedEmailCalls).toEqual([NORMALIZED_EMAIL]);
  });

  it("nunca resolve ApplicationAccess - o resultado nao tem nenhum vestigio disso", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
    passwordVerifier.shouldMatch = true;

    const result = await service.execute({ email: NORMALIZED_EMAIL, password: "senha-correta-123456" });

    expect(result).not.toHaveProperty("applicationAccesses");
    expect(result).not.toHaveProperty("admin");
    expect(result).not.toHaveProperty("roles");
  });
});

describe("AuthenticateIdentityService - 11. lastAuthenticatedAt so no sucesso", () => {
  it("sucesso: credentialRepository.update() e chamado com a Credential mutada (lastAuthenticatedAt setado)", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    const credential = buildActiveCredential();
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", credential);
    passwordVerifier.shouldMatch = true;

    await service.execute({ email: NORMALIZED_EMAIL, password: "senha-correta-123456" });

    expect(credentialRepository.updateCalls).toHaveLength(1);
    expect(credentialRepository.updateCalls[0]?.credential.getLastAuthenticatedAt()).toBeInstanceOf(Date);
    expect(credentialRepository.updateCalls[0]?.expectedVersion).toBe(1);
    expect(credentialRepository.updateCalls[0]?.credential.getVersion()).toBe(2);
  });

  it("senha errada: credentialRepository.update() NUNCA e chamado", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
    passwordVerifier.shouldMatch = false;

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "senha-errada" })).rejects.toThrow();

    expect(credentialRepository.updateCalls).toHaveLength(0);
  });

  it("e-mail inexistente: credentialRepository.update() NUNCA e chamado", async () => {
    const { credentialRepository, service } = createHarness();

    await expect(service.execute({ email: "inexistente@example.com", password: "qualquer" })).rejects.toThrow();

    expect(credentialRepository.updateCalls).toHaveLength(0);
  });

  it("Credential REVOKED: credentialRepository.update() NUNCA e chamado", async () => {
    const { identityRepository, credentialRepository, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(
      IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD",
      buildActiveCredential({ status: "REVOKED" })
    );

    await expect(service.execute({ email: NORMALIZED_EMAIL, password: "qualquer" })).rejects.toThrow();

    expect(credentialRepository.updateCalls).toHaveLength(0);
  });
});

describe("AuthenticateIdentityService - [revisão crítica, item 11] normalização de e-mail — mesma regra de Email.ts, nunca uma segunda regra", () => {
  it("caixa diferente (UPPERCASE) autentica a MESMA Identity com sucesso — não apenas a chamada de lookup, o resultado final", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
    passwordVerifier.shouldMatch = true;

    const result = await service.execute({ email: "PESSOA@EXAMPLE.COM", password: "senha-correta-123456" });

    expect(result.identityPublicId).toBe(IDENTITY_PUBLIC_ID);
  });

  it("caixa mista (Pessoa@Example.Com) também autentica a mesma Identity", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
    passwordVerifier.shouldMatch = true;

    const result = await service.execute({ email: "Pessoa@Example.Com", password: "senha-correta-123456" });

    expect(result.identityPublicId).toBe(IDENTITY_PUBLIC_ID);
  });

  it("espaços externos (antes/depois) são removidos — mesma regra de Email.ts (trim), autentica com sucesso", async () => {
    const { identityRepository, credentialRepository, passwordVerifier, service } = createHarness();
    identityRepository.byEmail.set(NORMALIZED_EMAIL, buildActiveIdentity());
    credentialRepository.byIdentityAndType.set(IDENTITY_PUBLIC_ID + ":LOCAL_PASSWORD", buildActiveCredential());
    passwordVerifier.shouldMatch = true;

    const result = await service.execute({
      email: "\t  pessoa@example.com  \n",
      password: "senha-correta-123456"
    });

    expect(result.identityPublicId).toBe(IDENTITY_PUBLIC_ID);
  });

  it("e-mail sintaticamente inválido (sem @, string vazia, só espaços) não revela diferença externa — mesmo AuthenticationFailedError genérico, nunca uma validação distinta", async () => {
    const malformedEmails = ["nao-e-um-email", "", "   ", "@@@", "a@b@c@example.com"];

    for (const malformedEmail of malformedEmails) {
      const { service } = createHarness();
      let caught: unknown;
      try {
        await service.execute({ email: malformedEmail, password: "senha-qualquer-123456" });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AuthenticationFailedError);
      expect((caught as AuthenticationFailedError).code).toBe("AUTHENTICATION_FAILED");
      expect((caught as AuthenticationFailedError).classification).toBe("AUTHENTICATION");
    }
  });

  it("nenhum e-mail (normalizado ou original) vai para a mensagem de erro", async () => {
    const { service } = createHarness();
    const submittedEmail = "email-especifico-de-teste@example.com";

    let caught: unknown;
    try {
      await service.execute({ email: submittedEmail, password: "senha-qualquer-123456" });
    } catch (error) {
      caught = error;
    }

    const message = (caught as AuthenticationFailedError).message;
    expect(message).not.toContain(submittedEmail);
    expect(message).not.toContain("email-especifico-de-teste");
    expect(message).not.toContain(NORMALIZED_EMAIL);
  });

  it("não usa nenhuma segunda regra de normalização — a lógica é idêntica à de Email.ts (trim + lowercase, nada mais, sem tratamento de unicode/acentos adicional)", async () => {
    const { identityRepository, service } = createHarness();

    // Confirma, via a chamada real de lookup, que a normalização é
    // EXATAMENTE trim+lowercase — nenhuma transformação adicional (ex.:
    // remoção de acentos, normalização de unicode NFKC, tratamento de
    // "+tag@dominio") que divergiria da regra já estabelecida em
    // Email.ts (que também não faz nenhum desses tratamentos, ADR
    // registrado como Pendente de decisão em IDENTITY-DOMAIN-DESIGN.md).
    await service.execute({ email: "  Café@Example.COM  ", password: "senha-qualquer" }).catch(() => undefined);

    expect(identityRepository.findByNormalizedEmailCalls).toEqual(["café@example.com"]);
  });
});

describe("AuthenticateIdentityService - senha nunca vaza", () => {
  it("a senha em texto puro nunca aparece na mensagem de erro, em nenhum cenario", async () => {
    const rawPassword = "senha-secreta-nao-deveria-vazar-999";
    const { service } = createHarness();

    let caught: unknown;
    try {
      await service.execute({ email: "inexistente@example.com", password: rawPassword });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).not.toContain(rawPassword);
  });
});
