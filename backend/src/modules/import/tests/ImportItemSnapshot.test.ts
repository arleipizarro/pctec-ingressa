import { describe, expect, it } from "vitest";
import {
  ForbiddenSnapshotFieldError,
  ImportItemSnapshot,
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
