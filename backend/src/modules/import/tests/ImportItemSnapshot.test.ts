import { describe, expect, it } from "vitest";
import {
  ForbiddenSnapshotFieldError,
  ImportItemSnapshot,
  REDACTED_MARKER,
  isForbiddenSnapshotField
} from "../domain/ImportItemSnapshot.js";

/**
 * Linha realista de `pctec_helpdesk.users`: os campos de cadastro e os
 * três sensíveis convivem na MESMA linha. Um `{...row}` levaria os três
 * para dentro de `import_batch_items`.
 */
const LINHA_USERS = {
  id: 35,
  name: "Fulano de Tal",
  email: "fulano@afip.com.br",
  password: "$2b$10$hashquenaopodevazar",
  role: "cliente",
  active: 1,
  client_id: 75,
  client_group_id: null,
  reset_token: "abcdef0123456789",
  reset_expires: new Date("2026-08-01T00:00:00.000Z"),
  last_login: new Date("2026-07-30T12:00:00.000Z"),
  pctecdb_id: null
};

const WHITELIST = ["id", "name", "email", "role", "active", "client_id", "client_group_id"];

describe("denylist de campos", () => {
  it.each([
    "password",
    "senha",
    "senha_temporaria",
    "reset_token",
    "resetToken",
    "password_hash",
    "user_password",
    "api_key",
    "secret",
    "authorization"
  ])("reprova %s", (field) => {
    expect(isForbiddenSnapshotField(field)).toBe(true);
  });

  it.each(["id", "name", "email", "role", "active", "client_id", "client_group_id", "last_login"])(
    "permite %s",
    (field) => {
      expect(isForbiddenSnapshotField(field)).toBe(false);
    }
  );
});

describe("ImportItemSnapshot", () => {
  it("só grava os campos da whitelist — sensíveis ficam fora mesmo estando na origem", () => {
    const snapshot = ImportItemSnapshot.fromWhitelist(WHITELIST, LINHA_USERS);
    const json = snapshot.toJSON();

    expect(Object.keys(json).sort()).toEqual([...WHITELIST].sort());
    expect(json).not.toHaveProperty("password");
    expect(json).not.toHaveProperty("reset_token");
    expect(json).not.toHaveProperty("reset_expires");

    const serializado = JSON.stringify(json);
    expect(serializado).not.toContain("$2b$10$");
    expect(serializado).not.toContain("abcdef0123456789");
  });

  it("recusa a própria whitelist se ela contiver campo proibido", () => {
    expect(() => ImportItemSnapshot.fromWhitelist([...WHITELIST, "password"], LINHA_USERS)).toThrow(
      ForbiddenSnapshotFieldError
    );
  });

  it("campo da whitelist ausente na origem simplesmente não entra", () => {
    const snapshot = ImportItemSnapshot.fromWhitelist(["id", "inexistente"], LINHA_USERS);
    expect(snapshot.toJSON()).toEqual({ id: 35 });
  });

  it("valor complexo vira null — registro bruto não entra por chave permitida", () => {
    const snapshot = ImportItemSnapshot.fromWhitelist(["payload"], { payload: { linha: LINHA_USERS } });
    expect(snapshot.toJSON()).toEqual({ payload: null });
    expect(JSON.stringify(snapshot.toJSON())).not.toContain("$2b$10$");
  });

  it("Date vira ISO string, não objeto", () => {
    const snapshot = ImportItemSnapshot.fromWhitelist(["last_login"], LINHA_USERS);
    expect(snapshot.toJSON()).toEqual({ last_login: "2026-07-30T12:00:00.000Z" });
  });

  it("null e undefined viram null", () => {
    const snapshot = ImportItemSnapshot.fromWhitelist(["client_group_id", "pctecdb_id"], LINHA_USERS);
    expect(snapshot.toJSON()).toEqual({ client_group_id: null, pctecdb_id: null });
  });
});


/**
 * Regressão do furo real: `hash`, `salt` e `authorization` estavam SÓ na
 * lista exata, então qualquer variação passava batido — justamente o que
 * a lista de fragmentos existe para pegar.
 *
 * Todos os nomes abaixo são sintéticos: são NOMES DE COLUNA plausíveis,
 * nenhum valor de origem real é lido ou usado.
 */
describe("denylist — variações de hash/salt/authorization", () => {
  it.each([
    "bcrypt_hash",
    "md5_hash",
    "user_hash",
    "auth_salt",
    "authorization_header",
    "senha_hash",
    "sha256_hash",
    "passwordSalt",
    "Authorization-Header"
  ])("%s é reprovado", (campo) => {
    expect(isForbiddenSnapshotField(campo)).toBe(true);
  });

  it("a whitelist não consegue forçar a entrada de uma variação", () => {
    expect(() => ImportItemSnapshot.fromWhitelist(["id", "bcrypt_hash"], { id: 1, bcrypt_hash: "x" })).toThrow(
      ForbiddenSnapshotFieldError
    );
  });
});

/**
 * Contrapeso do teste acima: a denylist é conservadora de propósito, mas
 * não pode inviabilizar o cadastro comercial que o importador precisa
 * gravar. Nomes sintéticos, do vocabulário do domínio.
 */
describe("denylist — campos legítimos NÃO são falso positivo", () => {
  it.each([
    "id",
    "name",
    "legal_name",
    "trade_name",
    "email",
    "email_normalized",
    "role",
    "active",
    "status",
    "client_id",
    "client_group_id",
    "pctecdb_id",
    "document_number",
    "phone",
    "city",
    "state",
    "contract_number",
    "created_at",
    "updated_at",
    "last_login",
    "access_profile",
    "membership_scope",
    "organization_public_id"
  ])("%s é aceito", (campo) => {
    expect(isForbiddenSnapshotField(campo)).toBe(false);
  });

  it("um snapshot só de campos legítimos é montado inteiro", () => {
    const snapshot = ImportItemSnapshot.fromWhitelist(WHITELIST, LINHA_USERS);
    expect(Object.keys(snapshot.toJSON()).sort()).toEqual([...WHITELIST].sort());
  });
});

/**
 * As três responsabilidades separadas: escrita reprova pela política
 * atual; reconstituição interpreta o que já foi aceito; saída redige o
 * que hoje é sensível.
 */
describe("compatibilidade histórica — política endurecida depois da escrita", () => {
  // Linha como teria sido gravada sob a política ANTIGA, quando
  // `bcrypt_hash` ainda passava pela denylist. Valor sintético.
  const LINHA_HISTORICA = { id: 35, name: "Fulano de Tal", bcrypt_hash: "valor-sintetico-nao-real" };

  it("a escrita de hoje REPROVA o campo que passou a ser proibido", () => {
    expect(() => ImportItemSnapshot.fromWhitelist(Object.keys(LINHA_HISTORICA), LINHA_HISTORICA)).toThrow(
      ForbiddenSnapshotFieldError
    );
  });

  it("a reconstituição do que já está no banco NÃO estoura", () => {
    expect(() => ImportItemSnapshot.fromPersistedRecord(LINHA_HISTORICA)).not.toThrow();
    const snapshot = ImportItemSnapshot.fromPersistedRecord(LINHA_HISTORICA);
    expect(Object.keys(snapshot.toJSON()).sort()).toEqual(["bcrypt_hash", "id", "name"]);
  });

  it("a SAÍDA redige o valor sensível e registra só o nome do campo", () => {
    const saida = ImportItemSnapshot.fromPersistedRecord(LINHA_HISTORICA).toRedactedJSON();

    expect(saida.redactedFields).toEqual(["bcrypt_hash"]);
    expect(saida.fields["bcrypt_hash"]).toBe(REDACTED_MARKER);
    // O valor original nunca aparece, em nenhuma chave.
    expect(JSON.stringify(saida)).not.toContain("valor-sintetico-nao-real");
    // Os campos legítimos continuam legíveis — a linha não é descartada.
    expect(saida.fields["id"]).toBe(35);
    expect(saida.fields["name"]).toBe("Fulano de Tal");
  });

  it("a redação é determinística — duas chamadas produzem exatamente a mesma saída", () => {
    const snapshot = ImportItemSnapshot.fromPersistedRecord(LINHA_HISTORICA);
    expect(JSON.stringify(snapshot.toRedactedJSON())).toBe(JSON.stringify(snapshot.toRedactedJSON()));
  });

  it("snapshot sem campo sensível sai intacto e com redactedFields vazio", () => {
    const saida = ImportItemSnapshot.fromWhitelist(WHITELIST, LINHA_USERS).toRedactedJSON();
    expect(saida.redactedFields).toEqual([]);
    expect(saida.fields["email"]).toBe("fulano@afip.com.br");
  });
});
