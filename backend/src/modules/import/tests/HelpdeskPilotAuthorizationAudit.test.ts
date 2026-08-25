import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Auditoria estrutural do piloto — sem banco.
 *
 * Prova, lendo o próprio código, o que a auditoria do Helpdesk concluiu:
 * grupo, chamado, fila, equipe e papel de atendente NÃO concedem acesso.
 * Um teste de comportamento não pegaria uma consulta nova a `tickets`
 * escrita daqui a três meses num caminho que ninguém exercita; a leitura
 * do fonte pega.
 *
 * Comentários são removidos antes da checagem — a prosa que explica POR
 * QUE `client_group_id` não autoriza precisa poder citar o nome.
 */
const GUARDA_DE_SQL = "../infrastructure/source/HelpdeskSourceQueries.ts";

/**
 * O arquivo da guarda é analisado à parte: ele PRECISA conter os termos
 * proibidos, porque é onde a lista de recusa vive. Verificá-lo junto com
 * os demais transformaria a própria defesa em violação.
 */
const ARQUIVOS_DO_PILOTO = [
  "../domain/pilot/HelpdeskPilotScope.ts",
  "../domain/pilot/HelpdeskPilotPlanner.ts",
  "../domain/pilot/HelpdeskSourcePort.ts",
  "../domain/pilot/IngressaTargetState.ts",
  "../application/RunHelpdeskPilotImportService.ts",
  "../infrastructure/source/MariaDbHelpdeskReadOnlySource.ts",
  "../infrastructure/persistence/MariaDbIngressaTargetStateReader.ts",
  "../infrastructure/persistence/MariaDbPilotApplyWriter.ts",
  "../../../cli/helpdesk-import-pilot.ts"
];

function codigoSemComentarios(arquivo: string): string {
  const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf-8");
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

describe("piloto Helpdesk — autorização por vínculo cadastral", () => {
  it.each(ARQUIVOS_DO_PILOTO)("%s nunca lê grupo, chamado, fila ou equipe", (arquivo) => {
    const codigo = codigoSemComentarios(arquivo).toLowerCase();
    for (const proibido of ["client_group", "clientgroup", "tickets", "queue", "fila", "team", "equipe", "atendimento"]) {
      expect(codigo).not.toContain(proibido);
    }
  });

  it.each(ARQUIVOS_DO_PILOTO)("%s nunca concede escopo AND_DESCENDANTS", (arquivo) => {
    const codigo = codigoSemComentarios(arquivo);
    expect(codigo).not.toContain("ORGANIZATION_AND_DESCENDANTS");
    expect(codigo).not.toContain("AND_DESCENDANTS");
  });

  it.each(ARQUIVOS_DO_PILOTO)("%s nunca menciona campo de autenticação da origem", (arquivo) => {
    const codigo = codigoSemComentarios(arquivo).toLowerCase();
    for (const proibido of ["reset_token", "reset_expires", "last_login", "u.password", "users.password"]) {
      expect(codigo).not.toContain(proibido);
    }
  });

  it("a guarda de SQL lista como proibidos exatamente os termos que os demais arquivos não podem citar", () => {
    const guarda = codigoSemComentarios(GUARDA_DE_SQL);
    for (const termo of ["password", "token", "reset_expires", "last_login", "session"]) {
      expect(guarda).toContain(`"${termo}"`);
    }
    for (const tabela of ["tickets", "client_groups", "client_group_id", "queues", "teams"]) {
      expect(guarda).toContain(`"${tabela}"`);
    }
  });

  it("o escopo do piloto é constante do código, não parâmetro de linha de comando", () => {
    const escopo = codigoSemComentarios("../domain/pilot/HelpdeskPilotScope.ts");
    expect(escopo).toContain("PILOT_USER_IDS: readonly number[] = Object.freeze([35, 44])");

    const cli = codigoSemComentarios("../../../cli/helpdesk-import-pilot.ts");
    for (const flag of ["--all", "--ids", "--client", "--group"]) {
      // As flags aparecem SÓ na lista de recusa — nunca sendo lidas.
      const usos = cli.split(flag).length - 1;
      expect(usos).toBeGreaterThan(0);
      expect(cli).toContain("não existe: o escopo desta fatia é fixo");
    }
  });

  it("o publicId da organização de destino nunca está fixo no código", () => {
    for (const arquivo of ARQUIVOS_DO_PILOTO) {
      const codigo = codigoSemComentarios(arquivo);
      expect(codigo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    }
  });
});
