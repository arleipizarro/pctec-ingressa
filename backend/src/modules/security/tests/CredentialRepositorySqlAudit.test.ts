import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Trava de regressão do UPDATE de Credential — sem banco.
 *
 * Bug real de v0.9.1: `MariaDbCredentialRepository.update()` nasceu
 * servindo só `recordSuccessfulAuthentication` e não incluía
 * `password_hash` no SET. Quando `resetPassword` passou a usá-lo, a
 * redefinição de senha reportava sucesso — versão subia, evento
 * `credential.changed` era gravado, o CLI imprimia a nova versão — e o
 * hash no banco continuava o antigo. O sintoma (login recusando a senha
 * recém-definida) aparecia a três camadas de distância da causa.
 *
 * Este teste lê o SQL do repositório porque a prova de comportamento
 * vive nos testes de integração, que `npm test` não executa. Sem esta
 * trava, a regressão voltaria sem a suíte padrão notar.
 */
const ARQUIVO = "../infrastructure/persistence/MariaDbCredentialRepository.ts";

function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

describe("MariaDbCredentialRepository — auditoria do SQL", () => {
  const fonte = semComentarios(readFileSync(new URL(ARQUIVO, import.meta.url), "utf-8"));
  const update = fonte.slice(fonte.indexOf("UPDATE credentials"), fonte.indexOf("WHERE public_id"));

  it("o UPDATE persiste password_hash", () => {
    expect(update).toMatch(/password_hash\s*=\s*\?/);
  });

  it("o valor do hash vem do agregado, na ordem dos placeholders", () => {
    const chamada = fonte.slice(fonte.indexOf("UPDATE credentials"), fonte.indexOf("const updateResult"));
    const posicaoHash = chamada.indexOf("getPasswordHash()");
    const posicaoUltimoAutenticado = chamada.indexOf("getLastAuthenticatedAt()");
    expect(posicaoHash).toBeGreaterThan(0);
    // `password_hash` é a primeira coluna do SET, então seu parâmetro
    // precisa vir antes do de `last_authenticated_at`.
    expect(posicaoHash).toBeLessThan(posicaoUltimoAutenticado);
  });

  it("mantém a trava otimista por versão", () => {
    expect(fonte).toMatch(/WHERE public_id = \?\s*\n?\s*AND version = \?/);
    expect(fonte).toContain("CredentialVersionConflictError");
  });

  it("nenhum SQL do repositório concatena entrada — só placeholders", () => {
    expect(fonte).not.toMatch(/`[^`]*\$\{[^}]*\}[^`]*`\s*,\s*\[/);
  });
});
