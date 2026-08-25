import { describe, expect, it } from "vitest";
import { parseArgs, extrairSenha, ResetAdminPasswordUsageError } from "../reset-admin-password.js";

const ADMIN = "66231e51-66fb-466d-af4f-ac7b925ca9ec";
const BASE = [`--identity-public-id=${ADMIN}`, "--password-stdin"];

describe("CLI de recuperação — argumentos", () => {
  it("aceita a forma completa", () => {
    expect(parseArgs(BASE)).toEqual({ identityPublicId: ADMIN });
  });

  it.each([["--password=algo"], ["--password"]])("recusa %s e explica por quê", (flag) => {
    expect(() => parseArgs([...BASE, flag])).toThrow(/aparece em `ps`/);
  });

  it("exige --password-stdin", () => {
    expect(() => parseArgs([`--identity-public-id=${ADMIN}`])).toThrow(/--password-stdin/);
  });

  it("exige identityPublicId em forma de publicId", () => {
    expect(() => parseArgs(["--password-stdin"])).toThrow(ResetAdminPasswordUsageError);
    expect(() => parseArgs(["--identity-public-id=admin", "--password-stdin"])).toThrow(
      ResetAdminPasswordUsageError
    );
  });
});

describe("CLI de recuperação — leitura do stdin", () => {
  it("aceita uma linha e descarta a quebra final", () => {
    expect(extrairSenha("uma-senha-sintetica\n")).toBe("uma-senha-sintetica");
    expect(extrairSenha("uma-senha-sintetica")).toBe("uma-senha-sintetica");
    expect(extrairSenha("uma-senha-sintetica\r\n")).toBe("uma-senha-sintetica");
  });

  it("preserva espaços internos — senha é bytes, não texto normalizado", () => {
    expect(extrairSenha("com espaco no meio\n")).toBe("com espaco no meio");
  });

  it.each([["vazio", ""], ["só quebra de linha", "\n"], ["só espaços", "   \n"]])(
    "recusa stdin %s",
    (_caso, entrada) => {
      expect(() => extrairSenha(entrada)).toThrow(/vazio/);
    }
  );

  it("recusa conteúdo extra — senha e confirmação coladas não viram palpite", () => {
    expect(() => extrairSenha("primeira\nsegunda\n")).toThrow(/mais de uma linha/);
  });

  it("a mensagem de recusa nunca ecoa o que veio no stdin", () => {
    const segredo = "senha-sintetica-que-nao-pode-ecoar";
    try {
      extrairSenha(`${segredo}\noutra-linha\n`);
      expect.unreachable("deveria recusar");
    } catch (erro) {
      expect((erro as Error).message).not.toContain(segredo);
    }
  });
});
