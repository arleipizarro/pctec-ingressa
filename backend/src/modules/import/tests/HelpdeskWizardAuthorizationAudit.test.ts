import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Auditoria estrutural do assistente — sem banco.
 *
 * Mesma técnica da auditoria do piloto (`HelpdeskPilotAuthorizationAudit`)
 * e pela mesma razão: um teste de comportamento não pegaria uma consulta
 * a `tickets` escrita daqui a três meses num caminho que ninguém
 * exercita. A leitura do fonte pega.
 *
 * Comentários são removidos antes da checagem — a prosa que explica POR
 * QUE `client_group_id` não é lido precisa poder citar o nome.
 */
const ARQUIVOS_DO_ASSISTENTE = [
  "../domain/wizard/HelpdeskImportScope.ts",
  "../domain/wizard/HelpdeskImportSelection.ts",
  "../domain/wizard/HelpdeskCatalogPort.ts",
  "../domain/wizard/HelpdeskImportPlanner.ts",
  "../domain/wizard/WizardTargetState.ts",
  "../application/GetHelpdeskCatalogService.ts",
  "../application/RunHelpdeskImportWizardService.ts",
  "../infrastructure/persistence/MariaDbWizardTargetStateReader.ts",
  "../infrastructure/persistence/MariaDbWizardApplyWriter.ts",
  "../infrastructure/HelpdeskImportComposition.ts",
  "../../admin/http/helpdeskImportRoutes.ts"
];

const ESCRITOR = "../infrastructure/persistence/MariaDbWizardApplyWriter.ts";
const PLANNER = "../domain/wizard/HelpdeskImportPlanner.ts";

function codigoSemComentarios(arquivo: string): string {
  const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf-8");
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

describe("assistente Helpdesk — autorização por vínculo cadastral", () => {
  it.each(ARQUIVOS_DO_ASSISTENTE)("%s nunca lê chamado, fila, equipe ou histórico de atendimento", (arquivo) => {
    const codigo = codigoSemComentarios(arquivo).toLowerCase();
    for (const proibido of ["ticket", "queue", "fila", "team", "equipe", "atendimento", "attendance"]) {
      expect(codigo).not.toContain(proibido);
    }
  });

  it.each(ARQUIVOS_DO_ASSISTENTE)("%s nunca lê grupo de cliente da origem", (arquivo) => {
    // O cadastro de grupo não é tabela do Helpdesk e `client_group_id`
    // não está no grant read-only. Enquanto for assim, nenhuma linha de
    // código pode citá-los fora de comentário.
    const codigo = codigoSemComentarios(arquivo).toLowerCase();
    for (const proibido of ["client_group", "clientgroup", "clientes_grupo", "pctecdb"]) {
      expect(codigo).not.toContain(proibido);
    }
  });

  it.each(ARQUIVOS_DO_ASSISTENTE)("%s nunca menciona campo de autenticação da origem", (arquivo) => {
    const codigo = codigoSemComentarios(arquivo).toLowerCase();
    for (const proibido of ["reset_token", "reset_expires", "last_login", "u.password", "users.password", "password_hash"]) {
      expect(codigo).not.toContain(proibido);
    }
  });

  it.each(ARQUIVOS_DO_ASSISTENTE)("%s nunca fixa um publicId de organização no código", (arquivo) => {
    expect(codigoSemComentarios(arquivo)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
    );
  });

  it.each(ARQUIVOS_DO_ASSISTENTE)("%s nunca resolve organização por razão social", (arquivo) => {
    // Casar por nome transformaria um `UPDATE clients SET name` do
    // Helpdesk em mudança de quem tem acesso a quê.
    const codigo = codigoSemComentarios(arquivo);
    expect(codigo).not.toMatch(/WHERE\s+legal_name\s*=/i);
    expect(codigo).not.toMatch(/legal_name\s+LIKE/i);
  });
});

describe("assistente Helpdesk — escopo de membership", () => {
  it("AND_DESCENDANTS só nasce de `membershipScopeFor`, e só a partir de vínculo de GRUPO", () => {
    const planner = codigoSemComentarios(PLANNER);
    const ocorrencias = planner.split("ORGANIZATION_AND_DESCENDANTS").length - 1;

    // Uma única ocorrência no domínio inteiro: dentro da função que
    // deriva o escopo do vínculo. Qualquer segunda ocorrência seria um
    // caminho alternativo para conceder escopo amplo.
    expect(ocorrencias).toBe(1);
    expect(planner).toContain(
      'return kind === "BUSINESS_GROUP" ? "ORGANIZATION_AND_DESCENDANTS" : "ORGANIZATION_ONLY";'
    );
  });

  it("nenhum outro arquivo do assistente escreve o escopo literal", () => {
    for (const arquivo of ARQUIVOS_DO_ASSISTENTE.filter((a) => a !== PLANNER)) {
      expect(codigoSemComentarios(arquivo)).not.toContain("ORGANIZATION_AND_DESCENDANTS");
    }
  });

  it("o escritor deriva o escopo da função, nunca de um campo da requisição", () => {
    const escritor = codigoSemComentarios(ESCRITOR);
    expect(escritor).toContain("scope: membershipScopeFor(plan.linkKind)");
  });
});

describe("assistente Helpdesk — nenhuma credencial", () => {
  it.each(ARQUIVOS_DO_ASSISTENTE)("%s não importa nem toca repositório de credencial", (arquivo) => {
    const codigo = codigoSemComentarios(arquivo);
    for (const proibido of ["CredentialRepository", "MariaDbCredentialRepository", "PasswordHash", "PlainPassword", "Argon2"]) {
      expect(codigo).not.toContain(proibido);
    }
    expect(codigo.toLowerCase()).not.toContain("credentials");
  });

  it("o escritor do APPLY ativa a identidade federada por ÚLTIMO, depois das quatro escritas", () => {
    // Recortado a partir de `writeUser`: `writeOrganization` também
    // chama `recordItems`, e procurar no arquivo inteiro acharia a
    // chamada da organização — que vem antes de tudo isto e faria o
    // teste provar o contrário do que pretende.
    const escritor = codigoSemComentarios(ESCRITOR);
    const corpoDoWriteUser = escritor.slice(escritor.indexOf("public async writeUser("));

    const posicaoDoLoop = corpoDoWriteUser.indexOf("for (const item of plan.items)");
    const posicaoDaAtivacao = corpoDoWriteUser.indexOf("activateFederated.execute");
    const posicaoDoRegistro = corpoDoWriteUser.indexOf("await recordItems(connection, targets)");

    expect(posicaoDoLoop).toBeGreaterThan(-1);
    expect(posicaoDaAtivacao).toBeGreaterThan(posicaoDoLoop);
    expect(posicaoDoRegistro).toBeGreaterThan(posicaoDaAtivacao);
  });

  it("o acesso concedido pelo assistente é sempre USER na aplicação consumidora", () => {
    const escritor = codigoSemComentarios(ESCRITOR);
    expect(escritor).toContain("accessProfile: WIZARD_ACCESS_PROFILE");
    expect(escritor).not.toContain('"ADMIN"');
  });
});

describe("assistente Helpdesk — o ator vem da sessão", () => {
  it("a rota nunca lê ator, aprovador ou perfil do corpo da requisição", () => {
    const rotas = codigoSemComentarios("../../admin/http/helpdeskImportRoutes.ts");

    expect(rotas).toContain('req.authorization?.identityPublicId');
    for (const campo of ["actorPublicId", "approvedByIdentityPublicId", "accessProfile", "membershipProfile", "scope"]) {
      expect(rotas).not.toContain(`corpo["${campo}"]`);
      expect(rotas).not.toContain(`corpo.${campo}`);
    }
  });

  it("a extração da seleção é lista fechada de quatro campos — nunca espalhamento do corpo", () => {
    const rotas = codigoSemComentarios("../../admin/http/helpdeskImportRoutes.ts");
    expect(rotas).not.toMatch(/\.\.\.\(?\s*(body|corpo|req\.body)/);
    for (const campo of [
      "sourceClientId",
      "selectedSourceUserIds",
      "targetOrganizationPublicId",
      "parentBusinessGroupPublicId"
    ]) {
      expect(rotas).toContain(`corpo["${campo}"]`);
    }
  });
});
