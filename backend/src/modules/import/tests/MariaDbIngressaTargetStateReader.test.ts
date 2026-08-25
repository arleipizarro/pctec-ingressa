import { describe, expect, it } from "vitest";
import type { Queryable } from "../../../shared/database/Queryable.js";
import {
  MariaDbIngressaTargetStateReader,
  PilotApplicationNotResolvedError,
  PilotOrganizationNotEligibleError,
  PilotOrganizationNotFoundError
} from "../infrastructure/persistence/MariaDbIngressaTargetStateReader.js";

const ORG_PUBLIC_ID = "971ec096-e7de-4cc1-be06-2b4709565757";
const ORG = { public_id: ORG_PUBLIC_ID, legal_name: "AFIP - BOSQUE", type: "COMPANY", status: "ACTIVE" };
const APP = { public_id: "app-1", code: "PCTEC_HELPDESK", status: "ACTIVE" };

class ConexaoRoteada implements Queryable {
  public readonly sqls: string[] = [];

  public constructor(private readonly roteador: (sql: string) => unknown[]) {}

  public async execute(sql: string, params?: readonly unknown[]): Promise<[unknown, unknown]> {
    this.sqls.push(sql);
    void params;
    return [this.roteador(sql), undefined];
  }
}

function rotearPadrao(overrides: Partial<Record<string, unknown[]>> = {}) {
  return (sql: string): unknown[] => {
    if (sql.includes("FROM organizations")) return overrides["organizations"] ?? [ORG];
    if (sql.includes("FROM applications")) return overrides["applications"] ?? [APP];
    if (sql.includes("identity_external_references")) return overrides["refs"] ?? [];
    if (sql.includes("FROM identities")) return overrides["identities"] ?? [];
    if (sql.includes("FROM memberships")) return overrides["memberships"] ?? [];
    if (sql.includes("FROM application_accesses")) return overrides["accesses"] ?? [];
    return [{ total: 0 }];
  };
}

const PARAMS = {
  targetOrganizationPublicId: ORG_PUBLIC_ID,
  applicationCode: "PCTEC_HELPDESK",
  sourceLegacyIds: [35, 44],
  emailsNormalized: ["piloto.um@example.invalid", "piloto.dois@example.invalid"]
};

describe("leitor do estado de destino", () => {
  it("resolve a organização pelo publicId informado, nunca por razão social", async () => {
    const conexao = new ConexaoRoteada(rotearPadrao());
    const estado = await new MariaDbIngressaTargetStateReader(conexao).read(PARAMS);

    expect(estado.organization.publicId).toBe(ORG_PUBLIC_ID);
    expect(estado.organization.legalName).toBe("AFIP - BOSQUE");
    const sqlOrg = conexao.sqls.find((s) => s.includes("FROM organizations")) ?? "";
    expect(sqlOrg).toContain("public_id = ?");
    expect(sqlOrg).not.toContain("legal_name = ?");
  });

  it.each([
    ["não existe", []],
    ["tem mais de uma linha — ambiguidade nunca vira palpite", [ORG, { ...ORG }]]
  ])("recusa quando a organização %s", async (_caso, linhas) => {
    const conexao = new ConexaoRoteada(rotearPadrao({ organizations: linhas }));
    await expect(new MariaDbIngressaTargetStateReader(conexao).read(PARAMS)).rejects.toThrow(
      PilotOrganizationNotFoundError
    );
  });

  it.each([
    ["INACTIVE", { ...ORG, status: "INACTIVE" }],
    ["BUSINESS_GROUP", { ...ORG, type: "BUSINESS_GROUP" }]
  ])("recusa organização %s com erro que diz o motivo real", async (_caso, linha) => {
    const conexao = new ConexaoRoteada(rotearPadrao({ organizations: [linha] }));
    await expect(new MariaDbIngressaTargetStateReader(conexao).read(PARAMS)).rejects.toThrow(
      PilotOrganizationNotEligibleError
    );
  });

  it("lê o estado de uma identidade isolada — usado para validar o aprovador", async () => {
    const conexao = new ConexaoRoteada(() => [
      { public_id: "identity-1", full_name: "Admin", email_normalized: "aprovador@example.invalid", status: "ACTIVE" }
    ]);
    const identidade = await new MariaDbIngressaTargetStateReader(conexao).findIdentityByPublicId("identity-1");
    expect(identidade?.status).toBe("ACTIVE");
    expect(conexao.sqls[0]?.trim().toUpperCase().startsWith("SELECT")).toBe(true);
  });

  it("recusa quando a aplicação PCTEC_HELPDESK não está ACTIVE", async () => {
    const conexao = new ConexaoRoteada(rotearPadrao({ applications: [] }));
    await expect(new MariaDbIngressaTargetStateReader(conexao).read(PARAMS)).rejects.toThrow(
      PilotApplicationNotResolvedError
    );
  });

  it("só emite SELECT — o leitor do destino nunca escreve", async () => {
    const conexao = new ConexaoRoteada(rotearPadrao());
    await new MariaDbIngressaTargetStateReader(conexao).read(PARAMS);
    expect(conexao.sqls.length).toBeGreaterThan(0);
    for (const sql of conexao.sqls) {
      expect(sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
    }
  });

  it("filtra referências externas por PCTEC_HELPDESK/users e status ACTIVE", async () => {
    const conexao = new ConexaoRoteada(rotearPadrao());
    await new MariaDbIngressaTargetStateReader(conexao).read(PARAMS);
    const sql = conexao.sqls.find((s) => s.includes("identity_external_references")) ?? "";
    expect(sql).toContain("system_code = ?");
    expect(sql).toContain("entity_type = ?");
    expect(sql).toContain("status = 'ACTIVE'");
  });

  it("limita membership e acesso à organização e à aplicação do piloto", async () => {
    const conexao = new ConexaoRoteada(
      rotearPadrao({
        refs: [
          {
            public_id: "ref-1",
            identity_public_id: "identity-1",
            legacy_id: 35,
            match_method: "CREATED_FROM_SOURCE",
            status: "ACTIVE"
          }
        ]
      })
    );
    await new MariaDbIngressaTargetStateReader(conexao).read(PARAMS);

    const sqlMembership = conexao.sqls.find((s) => s.includes("FROM memberships")) ?? "";
    expect(sqlMembership).toContain("organization_public_id = ?");
    expect(sqlMembership).toContain("status = 'ACTIVE'");

    const sqlAcesso = conexao.sqls.find((s) => s.includes("FROM application_accesses")) ?? "";
    expect(sqlAcesso).toContain("application_public_id = ?");
    expect(sqlAcesso).toContain("status = 'GRANTED'");
  });
});
