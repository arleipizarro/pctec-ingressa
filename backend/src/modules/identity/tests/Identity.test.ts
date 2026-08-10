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

describe("Identity.createFoundational() — bootstrap da primeira Identity (v0.5.0, ADR-027)", () => {
  function createFoundationalIdentity() {
    return Identity.createFoundational({
      fullName: "Fundador da Plataforma",
      email: "fundador@example.com",
      correlationId: "8f14e45f-ceea-467e-a1a3-0000000000f1"
    });
  }

  it("cria uma Identity type=HUMAN, status=PENDING", () => {
    const identity = createFoundationalIdentity();
    expect(identity.getType().toString()).toBe("HUMAN");
    expect(identity.getStatus().toString()).toBe("PENDING");
  });

  it("loginEnabled nasce false — nunca configurável pelo chamador (createFoundational não aceita esse parâmetro)", () => {
    const identity = createFoundationalIdentity();
    expect(identity.isLoginEnabled()).toBe(false);
  });

  it("createdByPublicId (persistência) é undefined — NUNCA um marcador fingindo ser Identity public_id", () => {
    const identity = createFoundationalIdentity();
    expect(identity.getCreatedAtActorPublicIdForPersistence()).toBeUndefined();
    expect(identity.getUpdatedByPublicIdForPersistence()).toBeUndefined();
  });

  it("version nasce 1, igual a qualquer Identity recém-criada", () => {
    const identity = createFoundationalIdentity();
    expect(identity.getVersion()).toBe(1);
  });

  it("produz exatamente 1 evento identity.created, com actorPublicId = 'BOOTSTRAP' — nunca o publicId da própria Identity", () => {
    const identity = createFoundationalIdentity();
    const events = identity.pullDomainEvents();

    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("identity.created");
    expect(events[0]?.actorPublicId).toBe("BOOTSTRAP");
    expect(events[0]?.actorPublicId).not.toBe(identity.getPublicId().toString());
  });

  it("não é possível confundir o marcador de evento com createdByPublicId — são campos e valores diferentes", () => {
    const identity = createFoundationalIdentity();
    const events = identity.pullDomainEvents();

    expect(events[0]?.actorPublicId).toBe(Identity.BOOTSTRAP_EVENT_ACTOR_MARKER);
    expect(identity.getCreatedAtActorPublicIdForPersistence()).not.toBe(Identity.BOOTSTRAP_EVENT_ACTOR_MARKER);
    expect(identity.getCreatedAtActorPublicIdForPersistence()).toBeUndefined();
  });

  it("aceita CPF opcional, igual a create()", () => {
    const identity = Identity.createFoundational({
      fullName: "Fundador com CPF",
      email: "fundador2@example.com",
      cpf: "52998224725",
      correlationId: "8f14e45f-ceea-467e-a1a3-0000000000f2"
    });
    expect(identity.getCpf()).toBeDefined();
  });

  it("payload do evento identity.created nunca contém CPF, mesmo quando informado", () => {
    const identity = Identity.createFoundational({
      fullName: "Fundador com CPF",
      email: "fundador3@example.com",
      cpf: "52998224725",
      correlationId: "8f14e45f-ceea-467e-a1a3-0000000000f3"
    });
    const events = identity.pullDomainEvents();
    expect(JSON.stringify(events[0]?.payload)).not.toContain("cpf");
    expect(JSON.stringify(events[0]?.payload)).not.toContain("52998224725");
  });

  it("gera um publicId aleatório (UUID), nunca fornecido pelo chamador — createFoundational não aceita publicId como parâmetro", () => {
    const a = createFoundationalIdentity();
    const b = Identity.createFoundational({
      fullName: "Outro Fundador",
      email: "outro@example.com",
      correlationId: "8f14e45f-ceea-467e-a1a3-0000000000f4"
    });
    expect(a.getPublicId().equals(b.getPublicId())).toBe(false);
  });

  it("nome/e-mail inválidos continuam validados normalmente (mesmas regras de create())", () => {
    expect(() =>
      Identity.createFoundational({
        fullName: "",
        email: "fundador@example.com",
        correlationId: "8f14e45f-ceea-467e-a1a3-0000000000f5"
      })
    ).toThrow();
    expect(() =>
      Identity.createFoundational({
        fullName: "Nome Válido",
        email: "nao-e-email",
        correlationId: "8f14e45f-ceea-467e-a1a3-0000000000f6"
      })
    ).toThrow();
  });
});

describe("Identity.reconstitute — correção do bug real de carregamento (v0.6.0, pós-publicação)", () => {
  const BASE_STATE = {
    internalId: 1,
    publicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
    type: "HUMAN",
    fullName: "Pessoa Reconstituída",
    email: "reconstituida@example.com",
    emailNormalized: "reconstituida@example.com",
    status: "ACTIVE",
    loginEnabled: true,
    version: 3,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z")
  };

  it("E) reconstitute com updatedByPublicId='BOOTSTRAP' funciona — getUpdatedByPublicIdForPersistence() === 'BOOTSTRAP'", () => {
    const identity = Identity.reconstitute({
      ...BASE_STATE,
      updatedByPublicId: "BOOTSTRAP"
    });

    expect(identity.getUpdatedByPublicIdForPersistence()).toBe("BOOTSTRAP");
  });

  it("F) reconstitute com createdByPublicId='SYSTEM', updatedByPublicId='BOOTSTRAP', deletedByPublicId=UUID válido — todos preservados corretamente", () => {
    const validUuid = "88888888-8888-8888-8888-888888888888";

    const identity = Identity.reconstitute({
      ...BASE_STATE,
      status: "DELETED",
      createdByPublicId: "SYSTEM",
      updatedByPublicId: "BOOTSTRAP",
      deletedAt: new Date("2026-01-03T00:00:00Z"),
      deletedByPublicId: validUuid
    });

    expect(identity.getCreatedAtActorPublicIdForPersistence()).toBe("SYSTEM");
    expect(identity.getUpdatedByPublicIdForPersistence()).toBe("BOOTSTRAP");
    expect(identity.getDeletedByPublicIdForPersistence()).toBe(validUuid);
  });

  it("G) reconstitute com string arbitrária persistida ('NAO-E-UUID') continua falhando — nunca aceita silenciosamente", () => {
    expect(() =>
      Identity.reconstitute({
        ...BASE_STATE,
        updatedByPublicId: "NAO-E-UUID"
      })
    ).toThrow();
  });

  it("reconstitute com um UUID válido em updatedByPublicId (caso comum, não-marcador) continua funcionando normalmente", () => {
    const validUuid = "99999999-9999-9999-9999-999999999999";

    const identity = Identity.reconstitute({
      ...BASE_STATE,
      updatedByPublicId: validUuid
    });

    expect(identity.getUpdatedByPublicIdForPersistence()).toBe(validUuid);
  });

  it("reconstitute sem nenhum dos três campos de auditoria (todos undefined) continua funcionando normalmente", () => {
    const identity = Identity.reconstitute(BASE_STATE);

    expect(identity.getUpdatedByPublicIdForPersistence()).toBeUndefined();
    expect(identity.getDeletedByPublicIdForPersistence()).toBeUndefined();
    expect(identity.getCreatedAtActorPublicIdForPersistence()).toBeUndefined();
  });
});
