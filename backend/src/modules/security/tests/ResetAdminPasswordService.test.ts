import { describe, expect, it, vi } from "vitest";
import {
  IdentityNotActiveForResetError,
  IdentityNotFoundForResetError,
  LoginDisabledForResetError,
  ResetAdminPasswordService,
  RESET_REASON_CODE
} from "../application/ResetAdminPasswordService.js";
import { ApplicationAccessDeniedError } from "../../authorization/domain/errors/AuthorizationErrors.js";
import { CredentialNotFoundError } from "../domain/errors/CredentialErrors.js";
import { CredentialPasswordPolicyViolationError } from "../domain/value-objects/PlainPassword.js";

const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const SENHA_VALIDA = "recuperacao-sintetica-desta-suite-2026";

interface Cenario {
  readonly identidade?: { status: string; loginEnabled: boolean } | null;
  readonly ehAdmin?: boolean;
  readonly credencial?: boolean;
  readonly sessoesAtivas?: number;
}

function montar(cenario: Cenario = {}) {
  const escritas = { credencial: [] as unknown[], sessoes: [] as unknown[], auditoria: [] as unknown[][] };
  const hashes: unknown[] = [];
  const revogadas: string[] = [];

  const credencial = {
    getVersion: () => 4,
    getPublicId: () => ({ toString: () => "cred-1" }),
    resetPassword: vi.fn(),
    pullDomainEvents: () => [{ eventType: "credential.changed", payload: { reasonCode: RESET_REASON_CODE } }]
  };

  const sessoes = Array.from({ length: cenario.sessoesAtivas ?? 0 }, (_, i) => ({
    getVersion: () => 1,
    revoke: (props: { reason: string }) => revogadas.push(`s${i}:${props.reason}`),
    pullDomainEvents: () => [{ eventType: "session.revoked", payload: {} }]
  }));

  const service = new ResetAdminPasswordService({
    unitOfWork: { runInTransaction: async (w: (c: unknown) => Promise<unknown>) => w({}) } as never,
    identityRepositoryFactory: () =>
      ({
        findByPublicId: async () =>
          cenario.identidade === null
            ? undefined
            : {
                getStatus: () => ({ toString: () => cenario.identidade?.status ?? "ACTIVE" }),
                isLoginEnabled: () => cenario.identidade?.loginEnabled ?? true
              }
      }) as never,
    credentialRepositoryFactory: () =>
      ({
        findByIdentityAndType: async () => (cenario.credencial === false ? undefined : credencial),
        update: async (c: unknown, v: number) => escritas.credencial.push({ c, v })
      }) as never,
    sessionRepositoryFactory: () =>
      ({
        findActiveByIdentityPublicId: async () => sessoes,
        update: async (s: unknown, v: number) => escritas.sessoes.push({ s, v })
      }) as never,
    applicationRepositoryFactory: () =>
      ({
        findByCode: async (code: { toString(): string }) => ({
          isActive: () => true,
          getPublicId: () => ({ toString: () => "app-1" }),
          getCode: () => ({ toString: () => code.toString() })
        })
      }) as never,
    applicationAccessRepositoryFactory: () =>
      ({
        findByIdentityAndApplication: async () =>
          cenario.ehAdmin === false
            ? undefined
            : {
                isGranted: () => true,
                getAccessProfile: () => ({ equals: (o: { toString(): string }) => o.toString() === "ADMIN", toString: () => "ADMIN" })
              }
      }) as never,
    auditEventRepositoryFactory: () => ({ insertMany: async (e: unknown[]) => escritas.auditoria.push(e) }) as never,
    passwordHasher: {
      hash: async (p: unknown) => {
        hashes.push(p);
        return { toString: () => "$argon2id$sintetico" };
      }
    } as never
  });

  return { service, escritas, hashes, revogadas, credencial };
}

describe("recuperação administrativa de senha", () => {
  it("redefine a credencial existente, sem criar outra", async () => {
    const { service, escritas, credencial } = montar();
    const resultado = await service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA });

    expect(credencial.resetPassword).toHaveBeenCalledTimes(1);
    expect(escritas.credencial).toHaveLength(1);
    expect((escritas.credencial[0] as { v: number }).v).toBe(4);
    expect(resultado.credentialPublicId).toBe("cred-1");
  });

  it("usa o hasher de produção, recebendo o Value Object e nunca a string crua", async () => {
    const { service, hashes } = montar();
    await service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA });

    expect(hashes).toHaveLength(1);
    expect(typeof hashes[0]).toBe("object");
    expect(JSON.stringify(hashes[0])).not.toContain(SENHA_VALIDA);
  });

  it("carimba o motivo da mudança na credencial", async () => {
    const { service, credencial } = montar();
    await service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA });

    const chamada = credencial.resetPassword.mock.calls[0]?.[0] as { reasonCode: string; expectedVersion: number };
    expect(chamada.reasonCode).toBe(RESET_REASON_CODE);
    expect(chamada.expectedVersion).toBe(4);
  });

  it("revoga todas as sessões ativas da identidade", async () => {
    const { service, escritas, revogadas } = montar({ sessoesAtivas: 3 });
    const resultado = await service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA });

    expect(resultado.revokedSessions).toBe(3);
    expect(escritas.sessoes).toHaveLength(3);
    expect(revogadas.every((r) => r.endsWith("ADMIN_PASSWORD_RECOVERY"))).toBe(true);
  });

  it("audita a mudança e cada revogação", async () => {
    const { service, escritas } = montar({ sessoesAtivas: 2 });
    await service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA });

    const eventos = escritas.auditoria[0] as unknown[];
    expect(eventos).toHaveLength(3);
  });

  it("recusa identidade que não é ADMIN — sem escrever nada", async () => {
    const { service, escritas } = montar({ ehAdmin: false });
    await expect(service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA })).rejects.toThrow(
      ApplicationAccessDeniedError
    );
    expect(escritas.credencial).toEqual([]);
    expect(escritas.sessoes).toEqual([]);
  });

  it.each(["PENDING", "BLOCKED", "INACTIVE"])("recusa identidade %s", async (status) => {
    const { service, escritas } = montar({ identidade: { status, loginEnabled: true } });
    await expect(service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA })).rejects.toThrow(
      IdentityNotActiveForResetError
    );
    expect(escritas.credencial).toEqual([]);
  });

  it("recusa identidade inexistente", async () => {
    const { service } = montar({ identidade: null });
    await expect(service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA })).rejects.toThrow(
      IdentityNotFoundForResetError
    );
  });

  it("recusa quando o login está desabilitado — reabilitar é outra decisão", async () => {
    const { service } = montar({ identidade: { status: "ACTIVE", loginEnabled: false } });
    await expect(service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA })).rejects.toThrow(
      LoginDisabledForResetError
    );
  });

  it("recusa quando não existe credencial para redefinir", async () => {
    const { service } = montar({ credencial: false });
    await expect(service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA })).rejects.toThrow(
      CredentialNotFoundError
    );
  });

  it.each([["curta demais", "abc"], ["vazia", "   "]])(
    "recusa senha %s pela política existente, antes de qualquer I/O",
    async (_caso, senha) => {
      const { service, escritas, hashes } = montar();
      await expect(service.execute({ identityPublicId: ADMIN, plainPassword: senha })).rejects.toThrow(
        CredentialPasswordPolicyViolationError
      );
      expect(hashes).toEqual([]);
      expect(escritas.credencial).toEqual([]);
    }
  );

  it("nem o resultado nem os eventos carregam senha ou hash", async () => {
    const { service, escritas } = montar({ sessoesAtivas: 1 });
    const resultado = await service.execute({ identityPublicId: ADMIN, plainPassword: SENHA_VALIDA });

    const serializado = `${JSON.stringify(resultado)}${JSON.stringify(escritas.auditoria)}`.toLowerCase();
    expect(serializado).not.toContain(SENHA_VALIDA.toLowerCase());
    expect(serializado).not.toContain("argon2");
    expect(serializado).not.toContain("hash");
  });
});
