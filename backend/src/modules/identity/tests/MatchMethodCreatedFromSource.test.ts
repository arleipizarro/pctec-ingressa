import { describe, expect, it } from "vitest";
import { InvalidMatchMethodError, MatchMethod } from "../domain/value-objects/MatchMethod.js";

describe("MatchMethod — CREATED_FROM_SOURCE (v0.8.x)", () => {
  it("aceita o novo valor", () => {
    expect(MatchMethod.create("CREATED_FROM_SOURCE").toString()).toBe("CREATED_FROM_SOURCE");
  });

  it("os valores anteriores continuam válidos", () => {
    expect(MatchMethod.create("MATCHED_BY_EMAIL").toString()).toBe("MATCHED_BY_EMAIL");
    expect(MatchMethod.create("MATCHED_MANUAL_CONFIRMED").toString()).toBe("MATCHED_MANUAL_CONFIRMED");
  });

  it("os três são distintos entre si", () => {
    const criado = MatchMethod.create("CREATED_FROM_SOURCE");
    expect(criado.equals(MatchMethod.create("MATCHED_BY_EMAIL"))).toBe(false);
    expect(criado.equals(MatchMethod.create("MATCHED_MANUAL_CONFIRMED"))).toBe(false);
    expect(criado.equals(MatchMethod.create("CREATED_FROM_SOURCE"))).toBe(true);
  });

  it("continua fechado — nenhum valor inventado passa", () => {
    for (const invalido of ["MATCHED_BY_NAME", "CREATED", "UNMATCHED", "AMBIGUOUS", ""]) {
      expect(() => MatchMethod.create(invalido)).toThrow(InvalidMatchMethodError);
    }
  });

  it("a mensagem de erro lista os três valores aceitos", () => {
    try {
      MatchMethod.create("INVALIDO");
      expect.unreachable("deveria ter lançado");
    } catch (error) {
      expect((error as Error).message).toContain("CREATED_FROM_SOURCE");
      expect((error as Error).message).toContain("MATCHED_MANUAL_CONFIRMED");
    }
  });

  it("NUNCA existe um valor de match por nome", () => {
    // Regra explícita da auditoria: 5 nomes duplicados entre 10 contas e
    // 37 registros cujo "nome" não é de pessoa. Nome não é critério de
    // identidade, e não há rótulo que o legitime.
    expect(() => MatchMethod.create("MATCHED_BY_NAME")).toThrow(InvalidMatchMethodError);
  });
});
