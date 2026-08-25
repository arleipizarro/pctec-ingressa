import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Trava de PII nas fixtures desta fatia.
 *
 * Existe por causa de um achado real na revisão do PR #4: as fixtures
 * dos testes unitários do piloto foram escritas copiando nome e e-mail
 * dos dois usuários reais direto do Helpdesk. Nada quebrava — fixture é
 * valor arbitrário — mas o destino era o histórico do Git, que é
 * permanente, replicado em cada clone e sem o controle de acesso que o
 * banco tem. No `import_batch_items` esse dado é trilha de auditoria e
 * está certo; num arquivo versionado, não.
 *
 * Sem esta trava, a próxima pessoa que precisar de uma fixture copia do
 * banco de novo — que foi exatamente como o achado nasceu.
 *
 * ESCOPO: só os arquivos de teste da fatia do piloto. Código de
 * produção não entra (não tem literal de e-mail nenhum, e a denylist de
 * `HelpdeskSourceQueries` cita nomes de campo, não endereços). Testes de
 * outras fatias também não: mudá-los é decisão de quem os mantém.
 */
const DIRETORIO_DE_TESTES = fileURLToPath(new URL(".", import.meta.url));

/**
 * Arquivos de teste desta fatia — os que a branch do piloto acrescentou.
 *
 * O casamento é por SUBSTRING, não por prefixo. A primeira versão desta
 * trava usava prefixo e deixava `RunHelpdeskPilotImportService.test.ts`
 * de fora — que era, justamente, um dos arquivos com dado real. Um
 * filtro de segurança que não cobre o arquivo do achado que o originou
 * é pior que nenhum: dá a impressão de proteção.
 */
const TOKENS_DA_FATIA = ["Pilot", "Helpdesk"];

/**
 * Arquivos da fatia cujo nome não carrega nenhum dos tokens acima. Lista
 * explícita e curta: se um teste novo do piloto não casar por nome, ele
 * entra aqui — e o teste de cobertura abaixo quebra até que entre.
 */
const EXTRAS_DA_FATIA = ["MariaDbIngressaTargetStateReader.test.ts"];

/** Cobertura esperada hoje — renomear ou remover arquivo quebra aqui. */
const ARQUIVOS_ESPERADOS = [
  "HelpdeskPilotAuthorizationAudit.test.ts",
  "HelpdeskPilotDryRun.integration.test.ts",
  "HelpdeskPilotPlanner.test.ts",
  "HelpdeskPilotSource.integration.test.ts",
  "HelpdeskPilotV1BatchObsolescence.test.ts",
  "HelpdeskSourceQueries.test.ts",
  "MariaDbHelpdeskReadOnlySource.test.ts",
  "MariaDbIngressaTargetStateReader.test.ts",
  "MariaDbPilotApplyWriter.test.ts",
  "RunHelpdeskPilotImportService.test.ts"
];

/**
 * Este arquivo se exclui da própria varredura, e a razão é estrutural:
 * os casos negativos que provam que a trava FUNCIONA precisam conter
 * endereços de domínio NÃO reservado — é isso que eles testam. Sem a
 * exclusão, a trava reprovaria a si mesma e a suíte nunca ficaria verde.
 *
 * O custo é conhecido e aceito: um endereço real escondido aqui dentro
 * passaria. Em troca, os literais deste arquivo são sintéticos por
 * construção (`pessoa.real@`, `nome.sobrenome@`, `fulano@`) e existem
 * só como entrada de asserção — nenhum deles é fixture de decisão.
 */
const ARQUIVO_DESTA_TRAVA = "HelpdeskPilotFixturesPiiGuard.test.ts";

/**
 * Domínios reservados pela RFC 2606 / RFC 6761 para documentação e
 * teste. Nenhum deles entrega mensagem a ninguém — é essa a propriedade
 * que interessa, não o nome bonito.
 */
const DOMINIOS_PERMITIDOS = ["example.invalid", "example.com", "example.org", "example.net"];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function arquivosDaFatia(): readonly string[] {
  return readdirSync(DIRETORIO_DE_TESTES)
    .filter((nome) => nome.endsWith(".test.ts"))
    .filter(
      (nome) => TOKENS_DA_FATIA.some((token) => nome.includes(token)) || EXTRAS_DA_FATIA.includes(nome)
    )
    .filter((nome) => nome !== ARQUIVO_DESTA_TRAVA)
    .sort();
}

/**
 * Comentários saem antes da varredura: a prosa que explica POR QUE um
 * e-mail real não pode entrar precisa poder falar de e-mail. As linhas
 * são preservadas (cada comentário vira linha vazia) para que o número
 * de linha reportado continue apontando o lugar certo no arquivo.
 */
function codigoSemComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/.*$/gm, "");
}

/**
 * Mascara antes de reportar: a mensagem de falha precisa localizar o
 * problema sem republicá-lo. Um teste de privacidade que imprime o dado
 * pessoal completo no log do CI cria o vazamento que veio impedir.
 */
function mascarar(email: string): string {
  const [local = "", dominio = ""] = email.split("@");
  const inicial = local.slice(0, 1);
  return `${inicial}${"*".repeat(Math.max(local.length - 1, 1))}@${dominio}`;
}

interface Ocorrencia {
  readonly arquivo: string;
  readonly linha: number;
  readonly mascarado: string;
}

function emailsProibidos(arquivo: string): readonly Ocorrencia[] {
  const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf-8");
  const linhas = codigoSemComentarios(fonte).split("\n");
  const achados: Ocorrencia[] = [];

  linhas.forEach((linha, indice) => {
    for (const email of linha.match(EMAIL) ?? []) {
      const dominio = email.split("@")[1] ?? "";
      if (!DOMINIOS_PERMITIDOS.includes(dominio.toLowerCase())) {
        achados.push({ arquivo, linha: indice + 1, mascarado: mascarar(email) });
      }
    }
  });

  return achados;
}

describe("fixtures do piloto — sem dado pessoal real", () => {
  const arquivos = arquivosDaFatia();

  it("cobre todos os arquivos de teste da fatia, menos ela mesma", () => {
    expect(arquivos).toEqual(ARQUIVOS_ESPERADOS);
    expect(arquivos).not.toContain(ARQUIVO_DESTA_TRAVA);
  });

  it.each(arquivosDaFatia())("%s só usa e-mail de domínio reservado", (arquivo) => {
    const achados = emailsProibidos(arquivo);
    const detalhe = achados.map((a) => `${a.arquivo}:${a.linha} -> ${a.mascarado}`).join("; ");
    expect(achados, `e-mail fora de domínio reservado: ${detalhe}`).toEqual([]);
  });

  it("a máscara do relatório não devolve o endereço completo", () => {
    const mascarado = mascarar("nome.sobrenome@empresa.com.br");
    expect(mascarado).toBe("n*************@empresa.com.br");
    expect(mascarado).not.toContain("nome.sobrenome");
  });

  it("a varredura pegaria um endereço real reintroduzido numa fixture", () => {
    const linhas = ["const u = { email: \"pessoa.real@empresa.com.br\" };"];
    const achados = linhas.flatMap((linha) =>
      (linha.match(EMAIL) ?? []).filter((e) => !DOMINIOS_PERMITIDOS.includes((e.split("@")[1] ?? "").toLowerCase()))
    );
    expect(achados).toHaveLength(1);
  });

  it("comentário técnico citando um domínio não derruba a varredura", () => {
    const fonte = ['// nunca use algo como fulano@empresa.com.br aqui', 'const ok = "x@example.invalid";'].join("\n");
    const semComentario = codigoSemComentarios(fonte);
    const achados = (semComentario.match(EMAIL) ?? []).filter(
      (e) => !DOMINIOS_PERMITIDOS.includes((e.split("@")[1] ?? "").toLowerCase())
    );
    expect(achados).toEqual([]);
  });

  it("a numeração de linha sobrevive à remoção de comentários", () => {
    const fonte = ["/* bloco", "de", "comentario */", "const x = 1;"].join("\n");
    expect(codigoSemComentarios(fonte).split("\n")).toHaveLength(4);
  });
});
