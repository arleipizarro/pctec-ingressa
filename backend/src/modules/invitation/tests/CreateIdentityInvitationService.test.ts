import { describe, expect, it } from "vitest";
import { CreateIdentityInvitationService, type InvitationCandidate } from "../application/CreateIdentityInvitationService.js";
import { ManualDevInvitationDelivery } from "../infrastructure/delivery/ManualDevInvitationDelivery.js";
import { hashInvitationToken } from "../infrastructure/token/invitationToken.js";
import { FakeAuditEventRepository, FakeInvitationRepository, FakeUnitOfWork } from "./invitationTestSupport.js";

const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const FEDERADA = "11111111-1111-4111-8111-111111111111";
const COM_SENHA = "22222222-2222-4222-8222-222222222222";
const LOCAL = "33333333-3333-4333-8333-333333333333";
const FEDERACAO_REVOGADA = "77777777-7777-4777-8777-777777777777";
const SEM_ACESSO = "44444444-4444-4444-8444-444444444444";
const BLOQUEADA = "55555555-5555-4555-8555-555555555555";
const DESCONHECIDA = "66666666-6666-4666-8666-666666666666";

const CANDIDATOS: readonly InvitationCandidate[] = [
  { identityPublicId: FEDERADA, fullName: "Pessoa Federada", email: "federada@example.invalid", status: "ACTIVE", loginEnabled: false, hasExternalReference: true, hasActiveExternalReference: true, hasCredential: false, hasApplicationAccess: true },
  { identityPublicId: COM_SENHA, fullName: "Pessoa Com Senha", email: "comsenha@example.invalid", status: "ACTIVE", loginEnabled: true, hasExternalReference: true, hasActiveExternalReference: true, hasCredential: true, hasApplicationAccess: true },
  // Conta criada AQUI pelo ADMIN: nunca teve referência externa. É
  // elegível — é exatamente o caso que o provisionamento produz.
  { identityPublicId: LOCAL, fullName: "Pessoa Local", email: "local@example.invalid", status: "ACTIVE", loginEnabled: false, hasExternalReference: false, hasActiveExternalReference: false, hasCredential: false, hasApplicationAccess: true },
  // Teve vínculo federado e o perdeu: continua barrada.
  { identityPublicId: FEDERACAO_REVOGADA, fullName: "Pessoa Ex-Federada", email: "exfederada@example.invalid", status: "ACTIVE", loginEnabled: false, hasExternalReference: true, hasActiveExternalReference: false, hasCredential: false, hasApplicationAccess: true },
  { identityPublicId: SEM_ACESSO, fullName: "Pessoa Sem Acesso", email: "semacesso@example.invalid", status: "ACTIVE", loginEnabled: false, hasExternalReference: true, hasActiveExternalReference: true, hasCredential: false, hasApplicationAccess: false },
  { identityPublicId: BLOQUEADA, fullName: "Pessoa Bloqueada", email: "bloqueada@example.invalid", status: "BLOCKED", loginEnabled: false, hasExternalReference: true, hasActiveExternalReference: true, hasCredential: false, hasApplicationAccess: true }
];

let contador = 0;

function montar(): { service: CreateIdentityInvitationService; convites: FakeInvitationRepository; auditoria: FakeAuditEventRepository } {
  contador = 0;
  const convites = new FakeInvitationRepository();
  const auditoria = new FakeAuditEventRepository();
  return {
    convites,
    auditoria,
    service: new CreateIdentityInvitationService(
      new FakeUnitOfWork(),
      { loadCandidates: async (ids) => CANDIDATOS.filter((c) => ids.includes(c.identityPublicId)) },
      () => convites,
      () => auditoria,
      { generate: () => `token-sintetico-${(contador += 1)}` },
      new ManualDevInvitationDelivery(),
      86_400,
      "https://ingressa.example.invalid/"
    )
  };
}

describe("emissão administrativa de convites", () => {
  it("emite para a identidade elegível e devolve o link UMA vez", async () => {
    const { service } = montar();
    const resultado = await service.execute({ identityPublicIds: [FEDERADA], invitedByPublicId: ADMIN });

    expect(resultado.deliveryMode).toBe("MANUAL_DEV");
    const item = resultado.results[0]!;
    expect(item.outcome).toBe("CREATED");
    // Link com o token no FRAGMENTO — nunca em query string, que entraria
    // no access log do servidor.
    expect(item.manualLink).toBe("https://ingressa.example.invalid/convite#token-sintetico-1");
    expect(item.delivered).toBe(false);
  });

  it("persiste SOMENTE o hash do token — o valor bruto nunca vai ao banco", async () => {
    const { service, convites } = montar();
    await service.execute({ identityPublicIds: [FEDERADA], invitedByPublicId: ADMIN });

    expect([...convites.porTokenHash.keys()]).toEqual([hashInvitationToken("token-sintetico-1")]);
    expect(JSON.stringify([...convites.porTokenHash.values()])).not.toContain("token-sintetico-1");
  });

  it("a auditoria registra o convite sem o token e sem o link", async () => {
    const { service, auditoria } = montar();
    await service.execute({ identityPublicIds: [FEDERADA], invitedByPublicId: ADMIN });

    expect(auditoria.tipos()).toEqual(["identity-invitation.created"]);
    const serializado = JSON.stringify(auditoria.eventos);
    expect(serializado).not.toContain("token-sintetico-1");
    expect(serializado).not.toContain(hashInvitationToken("token-sintetico-1"));
    expect(serializado).not.toContain("/convite#");
  });

  it.each([
    [COM_SENHA, "CREDENTIAL_ALREADY_EXISTS"],
    [FEDERACAO_REVOGADA, "IDENTITY_FEDERATION_INACTIVE"],
    [SEM_ACESSO, "NO_APPLICATION_ACCESS"],
    [BLOQUEADA, "IDENTITY_NOT_ACTIVE"],
    [DESCONHECIDA, "IDENTITY_NOT_FOUND"]
  ])("pula quem não é elegível, com o motivo (%s)", async (publicId, motivo) => {
    const { service, convites } = montar();
    const resultado = await service.execute({ identityPublicIds: [publicId], invitedByPublicId: ADMIN });

    expect(resultado.results[0]?.outcome).toBe("SKIPPED");
    expect(resultado.results[0]?.reasonCode).toBe(motivo);
    expect(resultado.results[0]?.manualLink).toBeNull();
    expect(convites.porTokenHash.size).toBe(0);
  });

  it("convida a identidade LOCAL, que nunca teve referência externa", async () => {
    const { service, convites } = montar();
    const resultado = await service.execute({ identityPublicIds: [LOCAL], invitedByPublicId: ADMIN });

    // A regra antiga respondia SKIPPED/IDENTITY_NOT_FEDERATED aqui, o que
    // tornava impossível convidar alguém provisionado pela tela.
    expect(resultado.results[0]?.outcome).toBe("CREATED");
    expect(resultado.results[0]?.reasonCode).toBeNull();
    expect(convites.porTokenHash.size).toBe(1);
  });

  it("uma identidade inelegível NÃO derruba o lote", async () => {
    const { service } = montar();
    const resultado = await service.execute({
      identityPublicIds: [COM_SENHA, FEDERADA, BLOQUEADA],
      invitedByPublicId: ADMIN
    });

    expect(resultado.results.map((r) => r.outcome)).toEqual(["SKIPPED", "CREATED", "SKIPPED"]);
  });

  it("um convite novo REVOGA os anteriores ainda pendentes da mesma pessoa", async () => {
    const { service, convites, auditoria } = montar();
    await service.execute({ identityPublicIds: [FEDERADA], invitedByPublicId: ADMIN });
    await service.execute({ identityPublicIds: [FEDERADA], invitedByPublicId: ADMIN });

    const estados = [...convites.porTokenHash.values()].map((c) => c.getStatus());
    expect(estados.filter((estado) => estado === "PENDING")).toHaveLength(1);
    expect(estados.filter((estado) => estado === "REVOKED")).toHaveLength(1);
    expect(auditoria.tipos()).toContain("identity-invitation.revoked");
  });

  it("seleção duplicada emite um único convite", async () => {
    const { service, convites } = montar();
    const resultado = await service.execute({
      identityPublicIds: [FEDERADA, FEDERADA],
      invitedByPublicId: ADMIN
    });

    expect(resultado.results).toHaveLength(1);
    expect(convites.porTokenHash.size).toBe(1);
  });
});
