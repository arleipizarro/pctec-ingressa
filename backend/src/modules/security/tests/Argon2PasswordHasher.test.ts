import { describe, it, expect } from "vitest";
import { Argon2PasswordHasher, ARGON2ID_PARAMS } from "../infrastructure/hashing/Argon2PasswordHasher.js";
import { PlainPassword } from "../domain/value-objects/PlainPassword.js";
import { PasswordHash } from "../domain/value-objects/PasswordHash.js";
import { DUMMY_PASSWORD_HASH } from "../infrastructure/hashing/DummyPasswordHash.js";

/**
 * Único arquivo desta suíte que chama a biblioteca `argon2` de verdade —
 * mais lento que os demais testes (hashing real), por isso isolado aqui.
 * Todos os outros testes desta fatia usam `FakePasswordHasher`.
 */
describe("Argon2PasswordHasher — 8. Argon2id real", () => {
  it(
    "gera um hash no formato PHC do argon2id a partir de uma senha real",
    async () => {
      const hasher = new Argon2PasswordHasher();
      const password = PlainPassword.create("senha-de-teste-real-123");

      const hash = await hasher.hash(password);

      expect(hash).toBeInstanceOf(PasswordHash);
      expect(hash.toString()).toMatch(/^\$argon2id\$v=\d+\$(m|p|t)=\d+,(m|p|t)=\d+,(m|p|t)=\d+\$/);
    },
    20_000
  );

  it(
    "9. o hash resultante nunca contém a senha em texto puro",
    async () => {
      const hasher = new Argon2PasswordHasher();
      const rawPassword = "minha-senha-super-secreta-999";
      const password = PlainPassword.create(rawPassword);

      const hash = await hasher.hash(password);

      expect(hash.toString()).not.toContain(rawPassword);
    },
    20_000
  );

  it(
    "hashes da mesma senha, em chamadas diferentes, produzem PHC strings diferentes (salt aleatório administrado pela biblioteca)",
    async () => {
      const hasher = new Argon2PasswordHasher();
      const password1 = PlainPassword.create("senha-repetida-123456");
      const password2 = PlainPassword.create("senha-repetida-123456");

      const hash1 = await hasher.hash(password1);
      const hash2 = await hasher.hash(password2);

      expect(hash1.toString()).not.toBe(hash2.toString());
    },
    20_000
  );

  it(
    "verify() confirma a senha correta e rejeita uma senha errada",
    async () => {
      const hasher = new Argon2PasswordHasher();
      const correctPassword = PlainPassword.create("senha-correta-123456");
      const wrongPassword = PlainPassword.create("senha-errada-1234567");

      const hash = await hasher.hash(correctPassword);

      await expect(hasher.verify(correctPassword, hash)).resolves.toBe(true);
      await expect(hasher.verify(wrongPassword, hash)).resolves.toBe(false);
    },
    20_000
  );

  it("os parâmetros de custo usados são os documentados/centralizados (ARGON2ID_PARAMS), não valores soltos", () => {
    expect(ARGON2ID_PARAMS.memoryCost).toBe(65536);
    expect(ARGON2ID_PARAMS.timeCost).toBe(3);
    expect(ARGON2ID_PARAMS.parallelism).toBe(4);
  });

  it(
    "[revisão crítica, item 6] o PHC real gerado cabe folgadamente em VARCHAR(255) (coluna credentials.password_hash, migration 0008)",
    async () => {
      const hasher = new Argon2PasswordHasher();
      const password = PlainPassword.create("uma-senha-realista-para-medir-o-comprimento-do-phc-1234567890");

      const hash = await hasher.hash(password);

      // Hash real medido: ~97 caracteres com os parâmetros atuais
      // (memoryCost=65536, timeCost=3, parallelism=4, salt/hash padrão
      // de 16/32 bytes). VARCHAR(255) dá margem de mais de 150
      // caracteres — folga suficiente mesmo se os parâmetros de custo
      // crescerem substancialmente após o benchmark de produção
      // (ADR-029).
      expect(hash.toString().length).toBeLessThan(150);
      expect(hash.toString().length).toBeLessThanOrEqual(255);
    },
    20_000
  );
});

describe("DUMMY_PASSWORD_HASH — validade real contra Argon2id de verdade (revisão crítica, item 2)", () => {
  it("é uma string PHC Argon2id sintaticamente válida (já garantido por PasswordHash.fromPhcString, mas confirmado aqui explicitamente)", () => {
    expect(() => PasswordHash.fromPhcString(DUMMY_PASSWORD_HASH.toString())).not.toThrow();
    expect(DUMMY_PASSWORD_HASH.toString()).toMatch(/^\$argon2id\$v=\d+\$/);
  });

  it(
    "Argon2PasswordHasher.verify(dummyHash, senha-qualquer) executa sem erro e retorna false",
    async () => {
      const hasher = new Argon2PasswordHasher();
      const anyPassword = PlainPassword.forVerification("uma-senha-qualquer-para-o-teste-999");

      const result = await hasher.verify(anyPassword, DUMMY_PASSWORD_HASH);

      expect(result).toBe(false);
    },
    20_000
  );

  it(
    "verify() com o dummy hash tem custo computacional real — mede um tempo mínimo consistente com hashing de verdade (não um atalho/mock disfarçado)",
    async () => {
      const hasher = new Argon2PasswordHasher();
      const anyPassword = PlainPassword.forVerification("outra-senha-qualquer-888");

      const start = process.hrtime.bigint();
      await hasher.verify(anyPassword, DUMMY_PASSWORD_HASH);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;

      // Não é um benchmark preciso (task, seção 8, explícito) — só uma
      // prova estrutural de que o dummy verify não é instantâneo (o que
      // indicaria que não está de fato executando Argon2id). Um valor
      // baixo e frouxo (1ms) é suficiente para essa prova sem tornar o
      // teste frágil em CI mais rápido/mais lento.
      expect(elapsedMs).toBeGreaterThan(1);
    },
    20_000
  );

  it("os parâmetros embutidos no PHC do dummy correspondem aos mesmos ARGON2ID_PARAMS usados para hash real (m, p, t idênticos)", () => {
    const match = DUMMY_PASSWORD_HASH.toString().match(/^\$argon2id\$v=\d+\$m=(\d+),p=(\d+),t=(\d+)\$/);
    expect(match).not.toBeNull();

    const [, memoryCost, parallelism, timeCost] = match as RegExpMatchArray;
    expect(Number(memoryCost)).toBe(ARGON2ID_PARAMS.memoryCost);
    expect(Number(parallelism)).toBe(ARGON2ID_PARAMS.parallelism);
    expect(Number(timeCost)).toBe(ARGON2ID_PARAMS.timeCost);
  });

  it("nenhuma senha real é usada para gerar o dummy em runtime — é uma constante fixa no código-fonte, nunca recalculada dinamicamente", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../infrastructure/hashing/DummyPasswordHash.ts", import.meta.url),
      "utf-8"
    );

    // A constante é construída via PasswordHash.fromPhcString(<literal
    // fixo>) — nunca via Argon2PasswordHasher.hash() (que exigiria uma
    // senha de entrada e geraria um valor novo a cada execução).
    expect(source).not.toContain("import { Argon2PasswordHasher");
    expect(source).not.toContain("new Argon2PasswordHasher");
    expect(source).not.toContain(".hash(");
    expect(source).toContain("PasswordHash.fromPhcString(");
  });
});
