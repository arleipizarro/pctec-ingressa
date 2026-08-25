import { describe, expect, it } from "vitest";

/**
 * Trava de PII no frontend.
 *
 * Mesma lição do achado do PR #4: fixture é valor arbitrário, e copiar
 * dado real do banco para dentro dela põe pessoa identificável no
 * histórico do Git — permanente, replicado em cada clone, sem o
 * controle de acesso que o banco tem. Aqui a superfície é maior ainda:
 * o que entra no frontend também vai para o bundle publicado.
 *
 * A varredura usa `import.meta.glob` (do próprio Vite) em vez de `fs`:
 * o projeto não tem `@types/node`, e ler o fonte pelo bundler mantém o
 * teste rodando no mesmo ambiente do app.
 */
const FONTES = import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const DOMINIOS_PERMITIDOS = ["example.invalid", "example.com", "example.org", "example.net"];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ESTE_ARQUIVO = "semPiiNasFixtures.test.ts";

/** Comentários saem antes: a prosa precisa poder citar o problema. */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/.*$/gm, "");
}

function mascarar(email: string): string {
  const [local = "", dominio = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 1))}@${dominio}`;
}

describe("frontend — nenhuma PII real no código", () => {
  const arquivos = Object.entries(FONTES).filter(([caminho]) => !caminho.endsWith(ESTE_ARQUIVO));

  it("a varredura enxerga o código-fonte", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(10);
  });

  it("todo e-mail literal usa domínio reservado", () => {
    const achados: string[] = [];
    for (const [caminho, fonte] of arquivos) {
      semComentarios(fonte)
        .split("\n")
        .forEach((linha, indice) => {
          for (const email of linha.match(EMAIL) ?? []) {
            const dominio = (email.split("@")[1] ?? "").toLowerCase();
            if (!DOMINIOS_PERMITIDOS.includes(dominio)) {
              achados.push(`${caminho}:${indice + 1} -> ${mascarar(email)}`);
            }
          }
        });
    }
    expect(achados, `e-mail fora de domínio reservado: ${achados.join("; ")}`).toEqual([]);
  });

  it("a máscara não devolve o endereço completo", () => {
    expect(mascarar("nome.sobrenome@empresa.com.br")).toBe("n*************@empresa.com.br");
  });

  it("nenhum identificador legado real do piloto aparece nas fixtures", () => {
    // Os ids 35/44/45 são operacionais do backend; a UI os recebe da
    // API e nunca os fixa. Fixture usa a faixa 999xxx.
    const fixtures = Object.entries(FONTES).find(([caminho]) => caminho.endsWith("fixtures.ts"))?.[1] ?? "";
    expect(fixtures).toMatch(/999935/);
    expect(fixtures).not.toMatch(/legacy_id:\s*(35|44|45)\b/);
  });
});
