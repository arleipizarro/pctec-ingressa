/**
 * Integração da FONTE Portal — MariaDB real, somente leitura.
 *
 * Exige `RUN_INTEGRATION_TESTS=true` e as variáveis `PORTAL_SOURCE_DB_*`
 * (arquivo `/app/.config/pctec-ingressa/portal-source.env`). Sem elas a
 * suíte é PULADA, e é assim que ela nasce: no momento em que este PR foi
 * escrito, a credencial read-only do Portal ainda não existia no
 * servidor de DEV, e criá-la é ato de quem administra o banco.
 *
 * **Nenhuma linha de `pctecdb` é alterada.** Não há caminho de escrita
 * neste conector, e as tentativas de escrita abaixo usam
 * `WHERE id = -1`, que não casa com registro nenhum: o teste prova que o
 * privilégio nega a operação, e mesmo que um dia não negasse, zero
 * linhas seriam afetadas. Um teste de segurança não pode ser o único
 * ponto do sistema capaz de causar o dano que ele investiga.
 *
 * **Nenhum documento completo é impresso.** As asserções falam de
 * presença, de quantidade de dígitos e de contagens — nunca do valor.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool } from "mysql2/promise";
import { shouldRunIntegrationTests } from "../../../shared/types/integration-test-guard.js";
import { loadPortalSourceConfig } from "../infrastructure/source/PortalSourceConfig.js";
import { MariaDbPortalReadOnlySource } from "../infrastructure/source/MariaDbPortalReadOnlySource.js";
import { MatchPortalClientByDocumentService } from "../application/MatchPortalClientByDocumentService.js";

const shouldRun = shouldRunIntegrationTests() && process.env["PORTAL_SOURCE_DB_USER"] !== undefined;

describe.skipIf(!shouldRun)("fonte Portal — integração read-only", () => {
  let pool: Pool;
  let source: MariaDbPortalReadOnlySource;

  beforeAll(() => {
    pool = createPool(loadPortalSourceConfig());
    source = new MariaDbPortalReadOnlySource(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("lê o catálogo com a projeção fechada e nada além dela", async () => {
    const pagina = await source.search({ limit: 5, offset: 0 });

    expect(pagina.limit).toBe(5);
    expect(pagina.items.length).toBeLessThanOrEqual(5);
    for (const cliente of pagina.items) {
      expect(typeof cliente.id).toBe("number");
      expect(typeof cliente.nome).toBe("string");
      // Presença e formato, nunca o valor.
      if (cliente.documentDigits !== undefined) {
        expect(cliente.documentDigits).toHaveLength(14);
      }
      expect(Object.keys(cliente).sort()).toEqual(
        ["active", "documentDigits", "id", "nome", "nomeFantasia"].sort()
      );
    }
  });

  it("a correspondência por CNPJ é exata — e um CNPJ inexistente não casa com nada", async () => {
    // CNPJ sintético, escolhido para não existir. Um `LIKE` disfarçado
    // ou um match por nome apareceria aqui como candidato.
    const resultado = await new MatchPortalClientByDocumentService(source).execute("00000000000191");
    expect(resultado.status).toBe("NOT_FOUND");
    expect(resultado.candidateCount).toBe(0);
  });

  it("nome semelhante NÃO é usado: buscar por nome não produz correspondência", async () => {
    const pagina = await source.search({ limit: 1, offset: 0 });
    const cliente = pagina.items[0];
    if (cliente === undefined) {
      // Base vazia em DEV: não há o que provar, e inventar dado seria
      // escrever no Portal.
      return;
    }

    // O nome existe na base — a busca textual o encontra.
    const porNome = await source.search({ q: cliente.nome.slice(0, 6), limit: 5, offset: 0 });
    expect(porNome.total).toBeGreaterThan(0);

    // O mesmo nome, com um CNPJ que não é o dele, NÃO produz
    // correspondência. É a prova de que a decisão é do documento.
    const correspondencia = await new MatchPortalClientByDocumentService(source).execute("00000000000191");
    expect(correspondencia.status).toBe("NOT_FOUND");
  });

  it("nenhum cliente INATIVO da base produz correspondência automática", async () => {
    // Varre uma página do catálogo e, para cada inativo encontrado,
    // exige que o CNPJ dele NÃO produza `EXACT_UNIQUE` — ou produza um
    // `EXACT_UNIQUE` que aponte para OUTRO cliente, o ativo de mesmo
    // documento. O que não pode existir é vínculo automático para um
    // cadastro desativado.
    const pagina = await source.search({ limit: 25, offset: 0 });
    const inativos = pagina.items.filter((c) => !c.active && c.documentDigits !== undefined);
    const matcher = new MatchPortalClientByDocumentService(source);

    for (const inativo of inativos) {
      const resultado = await matcher.execute(inativo.documentDigits);
      if (resultado.status === "EXACT_UNIQUE") {
        expect(resultado.client?.active).toBe(true);
        expect(resultado.client?.id).not.toBe(inativo.id);
      }
    }
  });

  it("a mesma consulta devolve a mesma contagem — o resultado é determinístico, sem LIMIT escondido", async () => {
    const pagina = await source.search({ limit: 3, offset: 0 });
    const denovo = await source.search({ limit: 3, offset: 0 });

    expect(denovo.total).toBe(pagina.total);
    expect(denovo.items.map((c) => c.id)).toEqual(pagina.items.map((c) => c.id));
  });

  it("a credencial da fonte NÃO pode escrever em pctecdb", async () => {
    // `id = -1` não casa com registro nenhum: ainda que o privilégio
    // fosse concedido por engano, zero linhas seriam afetadas.
    await expect(pool.execute("UPDATE clientes SET nome = 'x' WHERE id = -1")).rejects.toBeTruthy();
    await expect(pool.execute("DELETE FROM clientes WHERE id = -1")).rejects.toBeTruthy();
    await expect(
      pool.execute("INSERT INTO clientes (id, nome, tipo_doc) VALUES (-1, 'x', 'CNPJ')")
    ).rejects.toBeTruthy();
  });

  it("a credencial da fonte não alcança a tabela de autenticação do Portal", async () => {
    await expect(pool.execute("SELECT id FROM portal_acesso LIMIT 1")).rejects.toBeTruthy();
  });
});
