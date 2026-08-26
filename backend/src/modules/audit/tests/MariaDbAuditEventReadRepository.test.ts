import { describe, expect, it } from "vitest";
import { MariaDbAuditEventReadRepository } from "../infrastructure/MariaDbAuditEventReadRepository.js";
import type { Queryable } from "../../../shared/database/Queryable.js";
import { REDACTED_MARKER } from "../../../shared/security/redactionPolicy.js";

/** Grava o SQL e os parâmetros para inspeção — nenhuma conexão real. */
class QueryableEspiao implements Queryable {
  public readonly chamadas: { sql: string; params: readonly unknown[] }[] = [];
  public constructor(private readonly respostas: unknown[][] = []) {}

  public async execute(sql: string, params: readonly unknown[] = []): Promise<[unknown, unknown]> {
    this.chamadas.push({ sql, params });
    return [this.respostas[this.chamadas.length - 1] ?? [], undefined];
  }

  /** Consulta de itens é a segunda: a primeira é o COUNT. */
  public get consultaDeItens(): { sql: string; params: readonly unknown[] } {
    return this.chamadas[1]!;
  }
}

const LINHA = {
  event_public_id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  event_type: "identity-invitation.created",
  event_version: 1,
  aggregate_public_id: "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  actor_public_id: "ccccccc1-cccc-4ccc-8ccc-cccccccccccc",
  correlation_id: "ddddddd1-dddd-4ddd-8ddd-dddddddddddd",
  causation_id: null,
  payload_json: '{"deliveryMode":"MANUAL_DEV","token":"nunca-deveria-estar-aqui"}',
  occurred_at: "2026-08-26 12:00:00.000",
  persisted_at: "2026-08-26 12:00:00.010",
  actor_full_name: "Administrador Sintetico"
};

function montar(respostas: unknown[][] = [[{ total: 1 }], [LINHA]]) {
  const conexao = new QueryableEspiao(respostas);
  return { conexao, repo: new MariaDbAuditEventReadRepository(conexao) };
}

describe("projeção de auditoria — ordenação e teto", () => {
  it("ordena por occurred_at DESC com desempate estável por id", async () => {
    const { conexao, repo } = montar();
    await repo.listar({});

    // Sem o desempate, eventos da MESMA transação (mesmo milissegundo)
    // poderiam repetir ou sumir entre páginas.
    expect(conexao.consultaDeItens.sql).toContain("ORDER BY e.occurred_at DESC, e.id DESC");
  });

  it("aplica o teto do servidor mesmo quando o cliente pede mais", async () => {
    const { conexao, repo } = montar();
    const pagina = await repo.listar({ limit: 5000 });

    expect(pagina.limit).toBe(100);
    expect(conexao.consultaDeItens.params.slice(-2)).toEqual([100, 0]);
  });

  it("limit inválido cai no padrão, e offset negativo vira zero", async () => {
    const { repo } = montar();
    const pagina = await repo.listar({ limit: "muitos", offset: -50 });
    expect(pagina).toMatchObject({ limit: 25, offset: 0 });
  });
});

describe("projeção de auditoria — nada de id interno, nada de payload cru", () => {
  it("não seleciona a chave interna", async () => {
    const { conexao, repo } = montar();
    await repo.listar({});

    const colunas = conexao.consultaDeItens.sql.slice(0, conexao.consultaDeItens.sql.indexOf("FROM"));
    expect(colunas).not.toMatch(/\be\.id\b/);
  });

  it("o payload sai redigido — token gravado por engano não chega à tela", async () => {
    const { repo } = montar();
    const pagina = await repo.listar({});

    const item = pagina.items[0]!;
    expect(item.payload.fields["deliveryMode"]).toBe("MANUAL_DEV");
    expect(item.payload.fields["token"]).toBe(REDACTED_MARKER);
    expect(item.payload.redactedFields).toContain("token");
    expect(JSON.stringify(pagina)).not.toContain("nunca-deveria-estar-aqui");
  });

  it("datas saem em ISO", async () => {
    const { repo } = montar();
    const pagina = await repo.listar({});
    expect(pagina.items[0]!.occurred_at).toBe("2026-08-26T12:00:00.000Z");
  });

  it("ator sem Identity correspondente vem com nome nulo, nunca inventado", async () => {
    const { repo } = montar([[{ total: 1 }], [{ ...LINHA, actor_public_id: "SYSTEM", actor_full_name: null }]]);
    const pagina = await repo.listar({});

    expect(pagina.items[0]!.actor_public_id).toBe("SYSTEM");
    expect(pagina.items[0]!.actor_full_name).toBeNull();
  });
});

describe("projeção de auditoria — filtros", () => {
  it("todo filtro entra parametrizado, nunca interpolado", async () => {
    const { conexao, repo } = montar();
    await repo.listar({
      from: "2026-08-01",
      to: "2026-08-26",
      eventType: "identity.created",
      actorPublicId: "ccccccc1-cccc-4ccc-8ccc-cccccccccccc",
      aggregatePublicId: "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    });

    const { sql, params } = conexao.consultaDeItens;
    expect(sql).not.toContain("identity.created");
    expect(sql).not.toContain("2026-08-01");
    expect(params).toContain("identity.created");
    expect(params).toContain("ccccccc1-cccc-4ccc-8ccc-cccccccccccc");
  });

  it("o fim do período inclui o dia inteiro escolhido", async () => {
    const { conexao, repo } = montar();
    await repo.listar({ to: "2026-08-26" });

    // `2026-08-26` sozinho seria meia-noite e cortaria o próprio dia
    // fora do recorte.
    expect(conexao.consultaDeItens.params[0]).toBe("2026-08-26 23:59:59.999");
  });

  it.each([
    ["eventType", "'; DROP TABLE audit_events; --"],
    ["actorPublicId", "1 OR 1=1"],
    ["aggregatePublicId", "não-é-uuid"]
  ])("filtro fora de formato é ignorado, não interpolado (%s)", async (campo, valor) => {
    const { conexao, repo } = montar();
    await repo.listar({ [campo]: valor });

    const { sql, params } = conexao.consultaDeItens;
    expect(sql).not.toContain(valor);
    expect(params).not.toContain(valor);
    // Nenhuma condição foi acrescentada: só sobraram limit e offset.
    expect(params).toHaveLength(2);
  });

  it("sem filtro nenhum, a consulta não ganha WHERE", async () => {
    const { conexao, repo } = montar();
    await repo.listar({});
    expect(conexao.consultaDeItens.sql).not.toContain("WHERE");
  });

  it("o COUNT usa exatamente as mesmas condições da página", async () => {
    const { conexao, repo } = montar();
    await repo.listar({ eventType: "identity.created" });

    const count = conexao.chamadas[0]!;
    expect(count.sql).toContain("COUNT(*)");
    expect(count.params).toEqual(["identity.created"]);
  });
});

describe("projeção de auditoria — tipos de evento", () => {
  it("lê os tipos existentes com teto, sem parâmetro do cliente", async () => {
    const conexao = new QueryableEspiao([[{ event_type: "identity.created" }]]);
    const repo = new MariaDbAuditEventReadRepository(conexao);

    expect(await repo.listarTiposDeEvento()).toEqual(["identity.created"]);
    expect(conexao.chamadas[0]!.sql).toContain("DISTINCT event_type");
    expect(conexao.chamadas[0]!.sql).toContain("LIMIT 200");
  });
});
