import { describe, expect, it } from "vitest";
import { MariaDbApplicationAccessRepository } from "../infrastructure/persistence/MariaDbApplicationAccessRepository.js";
import { ApplicationAccess } from "../domain/ApplicationAccess.js";
import { readFileSync } from "node:fs";
import { ApplicationAccessActiveGrantConflictError } from "../domain/errors/ApplicationErrors.js";
import {
  PCTEC_HELPDESK_APPLICATION_CODE,
  PCTEC_HELPDESK_APPLICATION_NAME,
  PCTEC_HELPDESK_APPLICATION_PUBLIC_ID,
  PCTEC_PORTAL_APPLICATION_PUBLIC_ID,
  PCTEC_INGRESSA_APPLICATION_PUBLIC_ID
} from "../domain/value-objects/ApplicationCodes.js";
import type { Queryable } from "../../../shared/database/Queryable.js";

const IDENTITY = "11111111-2222-3333-4444-555555555555";
const ATOR = "99999999-8888-7777-6666-555555555555";

function acesso(profile: "USER" | "ADMIN", applicationPublicId: string = PCTEC_HELPDESK_APPLICATION_PUBLIC_ID) {
  return ApplicationAccess.grant({
    identityPublicId: IDENTITY,
    applicationPublicId,
    accessProfile: profile,
    grantedByIdentityPublicId: ATOR,
    correlationId: "11111111-1111-1111-1111-111111111111"
  });
}

/** Erro do driver mysql2 para violação de UNIQUE KEY. */
function erroDuplicidade(keyName: string): Error & { code: string; errno: number } {
  const error = new Error(
    `Duplicate entry '${IDENTITY}:${PCTEC_HELPDESK_APPLICATION_PUBLIC_ID}' for key '${keyName}'`
  ) as Error & { code: string; errno: number };
  error.code = "ER_DUP_ENTRY";
  error.errno = 1062;
  return error;
}

function connectionQueLanca(error: Error): Queryable {
  return {
    execute: async () => {
      throw error;
    }
  } as unknown as Queryable;
}

describe("uk_app_access_active_grant — violação vira erro de domínio", () => {
  it("duplicidade do índice de concessão ativa vira ApplicationAccessActiveGrantConflictError", async () => {
    const repository = new MariaDbApplicationAccessRepository(
      connectionQueLanca(erroDuplicidade("uk_app_access_active_grant"))
    );

    await expect(repository.insert(acesso("USER"))).rejects.toBeInstanceOf(
      ApplicationAccessActiveGrantConflictError
    );
  });

  it("USER e ADMIN simultâneos são bloqueados pelo MESMO índice — o perfil não está na chave", async () => {
    // O banco recusa a segunda concessão qualquer que seja o perfil:
    // a chave é (identity, application), sem access_profile.
    const repository = new MariaDbApplicationAccessRepository(
      connectionQueLanca(erroDuplicidade("uk_app_access_active_grant"))
    );

    for (const profile of ["USER", "ADMIN"] as const) {
      await expect(repository.insert(acesso(profile))).rejects.toBeInstanceOf(
        ApplicationAccessActiveGrantConflictError
      );
    }
  });

  it("duplicidade em OUTRO índice sobe crua — não é esta invariante de negócio", async () => {
    // uk_application_accesses_public_id indicaria bug de geração de UUID.
    const repository = new MariaDbApplicationAccessRepository(
      connectionQueLanca(erroDuplicidade("uk_application_accesses_public_id"))
    );

    await expect(repository.insert(acesso("USER"))).rejects.not.toBeInstanceOf(
      ApplicationAccessActiveGrantConflictError
    );
  });

  it("erro que não é duplicidade sobe cru", async () => {
    const repository = new MariaDbApplicationAccessRepository(
      connectionQueLanca(new Error("conexão perdida"))
    );

    await expect(repository.insert(acesso("USER"))).rejects.toThrow("conexão perdida");
  });

  it("aplicações diferentes não colidem — a chave inclui a aplicação", async () => {
    // Concessões para PCTEC_PORTAL e PCTEC_HELPDESK convivem: é o caso
    // real da conta de homologação, com acesso a duas aplicações.
    const inseridos: unknown[][] = [];
    const connection = {
      execute: async (_sql: string, params: unknown[]) => {
        inseridos.push(params);
        return [{ insertId: inseridos.length }, []];
      }
    } as unknown as Queryable;

    const repository = new MariaDbApplicationAccessRepository(connection);
    await repository.insert(acesso("USER", PCTEC_PORTAL_APPLICATION_PUBLIC_ID));
    await repository.insert(acesso("ADMIN", PCTEC_INGRESSA_APPLICATION_PUBLIC_ID));

    expect(inseridos).toHaveLength(2);
  });
});

describe("constantes da Application PCTEC_HELPDESK", () => {
  it("code e nome seguem o padrão das aplicações existentes", () => {
    expect(PCTEC_HELPDESK_APPLICATION_CODE).toBe("PCTEC_HELPDESK");
    expect(PCTEC_HELPDESK_APPLICATION_NAME).toBe("PCTEC Helpdesk");
  });

  it("publicId é determinístico e distinto dos demais", () => {
    expect(PCTEC_HELPDESK_APPLICATION_PUBLIC_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    const todos = new Set([
      PCTEC_HELPDESK_APPLICATION_PUBLIC_ID,
      PCTEC_PORTAL_APPLICATION_PUBLIC_ID,
      PCTEC_INGRESSA_APPLICATION_PUBLIC_ID
    ]);
    expect(todos.size).toBe(3);
  });
});

/**
 * Auditoria estrutural (sem banco): a condição "já existe acesso ativo"
 * tem UM código de erro só.
 *
 * `ApplicationAccessAlreadyGrantedError` / `APPLICATION_ACCESS_ALREADY_GRANTED`
 * era o guard antigo, que checava incluindo o perfil — a semântica que
 * esta entrega corrigiu. Ficou sem chamadores e foi removida. O nome era
 * próximo demais do guard novo: mantê-la exportada convidava alguém a
 * reusá-la por autocomplete, e a mesma recusa passaria a sair com dois
 * códigos diferentes para consumidores externos.
 */
describe("um único código de erro para concessão ativa duplicada", () => {
  const fonteErros = readFileSync(
    new URL("../domain/errors/ApplicationErrors.ts", import.meta.url),
    "utf-8"
  );

  it("o código do guard antigo não existe mais no módulo de erros", () => {
    expect(fonteErros).not.toContain("APPLICATION_ACCESS_ALREADY_GRANTED");
    expect(fonteErros).not.toContain("ApplicationAccessAlreadyGrantedError");
  });

  it("o código do guard atual continua declarado", () => {
    expect(fonteErros).toContain("APPLICATION_ACCESS_ACTIVE_GRANT_CONFLICT");
    expect(new ApplicationAccessActiveGrantConflictError().code).toBe("APPLICATION_ACCESS_ACTIVE_GRANT_CONFLICT");
  });
});
