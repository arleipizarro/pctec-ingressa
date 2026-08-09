import { describe, it, expect } from "vitest";
import { Argon2PasswordHasher, ARGON2ID_PARAMS } from "../infrastructure/hashing/Argon2PasswordHasher.js";
import { PlainPassword } from "../domain/value-objects/PlainPassword.js";
import { PasswordHash } from "../domain/value-objects/PasswordHash.js";

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
