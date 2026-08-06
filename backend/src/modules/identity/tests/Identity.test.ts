import { describe, it, expect } from "vitest";
import { Identity } from "../domain/Identity.js";
import { ActorPublicId, ActorRequiredError } from "../domain/value-objects/ActorPublicId.js";
import { IdentityTypeNotSupportedError } from "../domain/value-objects/IdentityType.js";
import { EmailRequiredError } from "../domain/value-objects/Email.js";
import { InvalidIdentityNameError } from "../domain/value-objects/IdentityName.js";
import {
  InvalidIdentityStatusTransitionError,
  IdentityDeletedError
} from "../domain/value-objects/IdentityStatus.js";
import { IdentityVersionConflictError } from "../domain/errors/IdentityErrors.js";

const SYSTEM_ACTOR = ActorPublicId.system();
const CORRELATION_ID = "8f14e45f-ceea-467e-a1a3-000000000001";

function createValidIdentity() {
  return Identity.create({
    type: "HUMAN",
    fullName: "Maria da Silva",
    email: "maria@example.com",
    actor: SYSTEM_ACTOR,
    correlationId: CORRELATION_ID
  });
}

describe("Identity — criação (CreateIdentity)", () => {
  it("1. cria uma identidade HUMAN válida com PENDING e loginEnabled=false", () => {
    const identity = createValidIdentity();

    expect(identity.getType().toString()).toBe("HUMAN");
    expect(identity.getStatus().toString()).toBe("PENDING");
    expect(identity.isLoginEnabled()).toBe(false);
    expect(identity.getVersion()).toBe(1);
    expect(identity.getPublicId().toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("2. rejeita a criação com type diferente de HUMAN", () => {
    expect(() =>
      Identity.create({
        type: "DEVICE",
        fullName: "Dispositivo X",
        email: "device@example.com",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      })
    ).toThrow(IdentityTypeNotSupportedError);
  });

  it("3. exige e-mail (erro IDENTITY_EMAIL_REQUIRED)", () => {
    expect(() =>
      Identity.create({
        type: "HUMAN",
        fullName: "Sem Email",
        email: "",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      })
    ).toThrow(EmailRequiredError);
  });

  it("rejeita nome vazio (após trim) com IDENTITY_NAME_INVALID, sem vazar o valor recebido", () => {
    let caught: unknown;
    try {
      Identity.create({
        type: "HUMAN",
        fullName: "   ",
        email: "nomevazio@example.com",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvalidIdentityNameError);
    expect((caught as InvalidIdentityNameError).code).toBe("IDENTITY_NAME_INVALID");
    // A mensagem descreve a condição, nunca ecoa o valor bruto recebido.
    expect((caught as Error).message).not.toContain("   ");
  });

  it("rejeita nome que excede o tamanho máximo com IDENTITY_NAME_INVALID, sem vazar o valor recebido", () => {
    const tooLong = "A".repeat(300);
    let caught: unknown;
    try {
      Identity.create({
        type: "HUMAN",
        fullName: tooLong,
        email: "nomelongo@example.com",
        actor: SYSTEM_ACTOR,
        correlationId: CORRELATION_ID
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvalidIdentityNameError);
    expect((caught as InvalidIdentityNameError).code).toBe("IDENTITY_NAME_INVALID");
    expect((caught as Error).message).not.toContain(tooLong);
  });

  it("4. normaliza e-mail de forma case-insensitive", () => {
    const identity = Identity.create({
      type: "HUMAN",
      fullName: "Caixa Diferente",
      email: "Pessoa@Exemplo.com",
      actor: SYSTEM_ACTOR,
      correlationId: CORRELATION_ID
    });

    expect(identity.getEmail().toString()).toBe("Pessoa@Exemplo.com");
    expect(identity.getEmail().normalized()).toBe("pessoa@exemplo.com");
  });

  it("5. permite CPF ausente", () => {
    const identity = createValidIdentity();
    expect(identity.getCpf()).toBeUndefined();
  });

  it("6. normaliza o CPF quando informado", () => {
    const identity = Identity.create({
      type: "HUMAN",
      fullName: "Com CPF",
      email: "comcpf@example.com",
      cpf: "123.456.789-00",
      actor: SYSTEM_ACTOR,
      correlationId: CORRELATION_ID
    });

    expect(identity.getCpf()?.toString()).toBe("123.456.789-00");
    expect(identity.getCpf()?.normalized()).toBe("12345678900");
  });

  it("11. exige actor (ACTOR_REQUIRED) ao construir ActorPublicId sem valor", () => {
    expect(() => ActorPublicId.required(undefined)).toThrow(ActorRequiredError);
    expect(() => ActorPublicId.required("")).toThrow(ActorRequiredError);
  });

  it("13. gera o evento identity.created ao criar", () => {
    const identity = createValidIdentity();
    const events = identity.pullDomainEvents();

    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("identity.created");
    expect(events[0]?.aggregatePublicId).toBe(identity.getPublicId().toString());
  });

  it("14. o payload de identity.created não contém CPF integral nem internalId", () => {
    const identity = Identity.create({
      type: "HUMAN",
      fullName: "Com CPF Evento",
      email: "comcpfevento@example.com",
      cpf: "111.222.333-44",
      actor: SYSTEM_ACTOR,
      correlationId: CORRELATION_ID
    });
    const [event] = identity.pullDomainEvents();
    const serialized = JSON.stringify(event?.payload);

    expect(serialized).not.toMatch(/111\.222\.333-44|11122233344/);
    expect(serialized).not.toContain("internalId");
    expect(event?.payload).not.toHaveProperty("cpf");
  });

  it("15. o Aggregate não possui nenhuma propriedade relacionada a senha", () => {
    const identity = createValidIdentity();
    const ownKeys = Object.keys(identity as unknown as Record<string, unknown>);
    const passwordLike = ownKeys.filter((key) => /password|senha|secret|hash/i.test(key));

    expect(passwordLike).toEqual([]);
  });

  it("16. o Aggregate não possui nenhuma propriedade relacionada a IdentityProfile", () => {
    const identity = createValidIdentity();
    const ownKeys = Object.keys(identity as unknown as Record<string, unknown>);
    const profileLike = ownKeys.filter((key) => /profile/i.test(key));

    expect(profileLike).toEqual([]);
    expect((identity as unknown as Record<string, unknown>)["addIdentityProfile"]).toBeUndefined();
    expect((identity as unknown as Record<string, unknown>)["removeIdentityProfile"]).toBeUndefined();
  });
});

describe("Identity — transições de estado", () => {
  it("7. permite transições válidas (PENDING → ACTIVE → BLOCKED → ACTIVE)", () => {
    const identity = createValidIdentity();
    identity.pullDomainEvents();

    identity.activate({ actor: SYSTEM_ACTOR, expectedVersion: 1, correlationId: CORRELATION_ID });
    expect(identity.getStatus().toString()).toBe("ACTIVE");

    identity.block({ actor: SYSTEM_ACTOR, expectedVersion: 2, correlationId: CORRELATION_ID });
    expect(identity.getStatus().toString()).toBe("BLOCKED");

    identity.unblock({ actor: SYSTEM_ACTOR, expectedVersion: 3, correlationId: CORRELATION_ID });
    expect(identity.getStatus().toString()).toBe("ACTIVE");
  });

  it("8. rejeita transições inválidas (ex.: BLOCKED direto a partir de PENDING)", () => {
    const identity = createValidIdentity();

    expect(() =>
      identity.block({ actor: SYSTEM_ACTOR, expectedVersion: 1, correlationId: CORRELATION_ID })
    ).toThrow(InvalidIdentityStatusTransitionError);
  });

  it("9. DELETED é terminal — nenhuma transição operacional sai dele", () => {
    const identity = createValidIdentity();
    identity.logicallyDelete({
      actor: SYSTEM_ACTOR,
      expectedVersion: 1,
      deletionReason: "TEST_REASON",
      correlationId: CORRELATION_ID
    });

    expect(identity.getStatus().toString()).toBe("DELETED");
    expect(() =>
      identity.activate({ actor: SYSTEM_ACTOR, expectedVersion: 2, correlationId: CORRELATION_ID })
    ).toThrow(IdentityDeletedError);
  });

  it("12. version é incrementada a cada mutação bem-sucedida", () => {
    const identity = createValidIdentity();
    expect(identity.getVersion()).toBe(1);

    identity.activate({ actor: SYSTEM_ACTOR, expectedVersion: 1, correlationId: CORRELATION_ID });
    expect(identity.getVersion()).toBe(2);

    identity.enableLogin({ actor: SYSTEM_ACTOR, expectedVersion: 2, correlationId: CORRELATION_ID });
    expect(identity.getVersion()).toBe(3);
  });

  it("rejeita mutação com expectedVersion desatualizada (IDENTITY_VERSION_CONFLICT)", () => {
    const identity = createValidIdentity();

    expect(() =>
      identity.activate({ actor: SYSTEM_ACTOR, expectedVersion: 99, correlationId: CORRELATION_ID })
    ).toThrow(IdentityVersionConflictError);
  });
});

describe("Identity — login_enabled (idempotência)", () => {
  it("10. EnableLogin é idempotente: repetir não falha nem incrementa version", () => {
    const identity = createValidIdentity();

    identity.enableLogin({ actor: SYSTEM_ACTOR, expectedVersion: 1, correlationId: CORRELATION_ID });
    expect(identity.isLoginEnabled()).toBe(true);
    expect(identity.getVersion()).toBe(2);

    // Repetir com a MESMA expectedVersion=2 (a versão real atual) deve
    // funcionar por ser idempotente — não altera version, não falha.
    identity.enableLogin({ actor: SYSTEM_ACTOR, expectedVersion: 2, correlationId: CORRELATION_ID });
    expect(identity.isLoginEnabled()).toBe(true);
    expect(identity.getVersion()).toBe(2);
  });

  it("DisableLogin é idempotente na direção oposta", () => {
    const identity = createValidIdentity();
    identity.disableLogin({ actor: SYSTEM_ACTOR, expectedVersion: 1, correlationId: CORRELATION_ID });

    expect(identity.isLoginEnabled()).toBe(false);
    expect(identity.getVersion()).toBe(1);
  });
});

describe("Identity — exclusão lógica", () => {
  it("LogicallyDeleteIdentity exige deletion_reason e força login_enabled=false", () => {
    const identity = createValidIdentity();
    identity.enableLogin({ actor: SYSTEM_ACTOR, expectedVersion: 1, correlationId: CORRELATION_ID });

    identity.logicallyDelete({
      actor: SYSTEM_ACTOR,
      expectedVersion: 2,
      deletionReason: "USER_REQUEST",
      correlationId: CORRELATION_ID
    });

    expect(identity.getStatus().toString()).toBe("DELETED");
    expect(identity.isLoginEnabled()).toBe(false);
    expect(identity.getDeletedAt()).toBeInstanceOf(Date);
    expect(identity.getDeletionReason()?.toString()).toBe("USER_REQUEST");
  });

  it("não permite exclusão lógica sem deletion_reason", () => {
    const identity = createValidIdentity();
    expect(() =>
      identity.logicallyDelete({
        actor: SYSTEM_ACTOR,
        expectedVersion: 1,
        deletionReason: "",
        correlationId: CORRELATION_ID
      })
    ).toThrow();
  });
});

describe("Identity — internalId nunca exposto pelo domínio público", () => {
  it("getInternalIdForPersistence só é acessível via API explicitamente marcada para infraestrutura", () => {
    const identity = createValidIdentity();
    // O próprio nome do método sinaliza uso restrito à infraestrutura;
    // aqui validamos que nenhuma leitura "pública" comum (ex.: getters
    // usados por Application Services) o expõe implicitamente.
    expect(identity.getInternalIdForPersistence()).toBeUndefined();

    identity.assignInternalIdFromPersistence(42);
    expect(identity.getInternalIdForPersistence()).toBe(42);

    // Nenhum evento de domínio deve conter a chave internalId no payload
    // (checagem estrutural — evita falso positivo por coincidência de
    // dígitos dentro de um UUID aleatório).
    const events = identity.pullDomainEvents();
    for (const event of events) {
      expect(event.payload).not.toHaveProperty("internalId");
      expect(event.payload).not.toHaveProperty("id");
    }
  });
});
