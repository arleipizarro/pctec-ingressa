import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Auditoria estrutural (sem banco) dos repositórios do importador.
 *
 * Trava de regressão para um bug real desta entrega: o SQL das duas
 * inserções usava `CAST(? AS JSON)` — sintaxe do MySQL 8 que NÃO existe
 * na gramática do MariaDB, onde `JSON` é apelido de `LONGTEXT` com um
 * CHECK `json_valid(...)`. O efeito era um erro de sintaxe que derrubava
 * todo INSERT em `import_batches`/`import_batch_items`.
 *
 * Este teste nunca conecta a banco nenhum: lê o texto-fonte e garante
 * que a construção proibida não volte silenciosamente. É necessário
 * porque a prova real vive nos testes de integração, que `npm test` não
 * executa — sem esta trava, a regressão passaria pela suíte padrão.
 */
const ARQUIVOS = [
  "../infrastructure/persistence/MariaDbImportBatchRepository.ts",
  "../infrastructure/persistence/MariaDbImportBatchItemRepository.ts"
];

/**
 * Remove comentários de bloco e de linha antes de checar os termos
 * proibidos — a prosa que documenta POR QUE `CAST(... AS JSON)` não é
 * usado menciona legitimamente o termo.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

describe("repositórios do importador — auditoria de SQL (sem banco)", () => {
  it.each(ARQUIVOS)("%s nunca usa CAST(... AS JSON) — não existe no MariaDB", (arquivo) => {
    const fonte = stripComments(readFileSync(new URL(arquivo, import.meta.url), "utf-8"));
    expect(fonte.toUpperCase()).not.toMatch(/\bCAST\s*\([^)]*\bAS\s+JSON\b/);
  });

  it.each(ARQUIVOS)("%s serializa o JSON em JS e o passa como parâmetro", (arquivo) => {
    const fonte = stripComments(readFileSync(new URL(arquivo, import.meta.url), "utf-8"));
    // A serialização é responsabilidade do JS (`JSON.stringify`), não de
    // uma função SQL — foi justamente a tentativa de delegá-la ao banco
    // (`CAST(? AS JSON)`) que quebrou o INSERT.
    expect(fonte).toContain("JSON.stringify(");
  });
});
