/**
 * Limitação de tentativas de login — D8 / ADR-034.
 *
 * Determinísticos por construção: relógio injetado, contador em memória
 * com a MESMA semântica da implementação MariaDB (incremento atômico,
 * reinício de janela expirada), e nenhuma dependência de tempo real.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { Server } from "node:http";
import { afterEach } from "vitest";

import { createApp } from "../../../app/http/createApp.js";
import type { LoginService } from "../application/LoginService.js";
import type { LogoutService } from "../application/LogoutService.js";
import type { ValidateSessionService } from "../application/ValidateSessionService.js";
import { AuthenticationFailedError } from "../domain/errors/AuthenticationErrors.js";
import {
  LoginRateLimitPolicy,
  type LoginRateLimitBucket
} from "../domain/LoginRateLimitPolicy.js";
import type { LoginRateLimitCounter, LoginRateLimitStore } from "../domain/LoginRateLimitStore.js";
import type { AuditEventRepository } from "../../audit/domain/AuditEventRepository.js";
import type { AuditEvent } from "../../audit/domain/AuditEvent.js";
import { InMemoryLoginRateLimitStore } from "./InMemoryLoginRateLimitStore.js";

const JANELA_SEGUNDOS = 60;
const TETO_IP = 5;
const TETO_IP_IDENTIFICADOR = 2;
const T0 = new Date("2026-03-01T12:00:00.000Z");

class ContadorIndisponivel implements LoginRateLimitStore {
  public async consume(): Promise<readonly LoginRateLimitCounter[]> {
    throw new Error("banco indisponivel");
  }
  public async clear(): Promise<void> {
    throw new Error("banco indisponivel");
  }
}

class AuditoriaEmMemoria implements AuditEventRepository {
  public readonly eventos: AuditEvent[] = [];
  public async insert(event: AuditEvent): Promise<void> {
    this.eventos.push(event);
  }
  public async insertMany(events: readonly AuditEvent[]): Promise<void> {
    this.eventos.push(...events);
  }
}

class LoginQueSempreFalha {
  public chamadas = 0;
  public async execute(): Promise<never> {
    this.chamadas += 1;
    throw new AuthenticationFailedError("INVALID_PASSWORD");
  }
}

class LoginQueSempreAceita {
  public chamadas = 0;
  public async execute(): Promise<{
    identityPublicId: string;
    sessionPublicId: string;
    rawToken: string;
    expiresAt: Date;
  }> {
    this.chamadas += 1;
    return {
      identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      sessionPublicId: "22222222-2222-4222-8222-222222222222",
      rawToken: "token-sintetico",
      expiresAt: new Date(T0.getTime() + 3_600_000)
    };
  }
}

/** Aceita um único identificador; todos os outros falham. */
class LoginQueAceitaSomente {
  public chamadas = 0;
  public constructor(private readonly email: string) {}
  public async execute(input: { email: string }): Promise<{
    identityPublicId: string;
    sessionPublicId: string;
    rawToken: string;
    expiresAt: Date;
  }> {
    this.chamadas += 1;
    if (input.email.trim().toLowerCase() !== this.email) {
      throw new AuthenticationFailedError("INVALID_PASSWORD");
    }
    return {
      identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      sessionPublicId: "22222222-2222-4222-8222-222222222222",
      rawToken: "token-sintetico",
      expiresAt: new Date(T0.getTime() + 3_600_000)
    };
  }
}

/**
 * Alterna acerto e erro — é o padrão de quem TEM uma credencial válida e
 * tentaria usar os próprios sucessos para renovar orçamento do contador
 * de origem.
 */
class LoginQueAlterna {
  public chamadas = 0;
  public async execute(): Promise<{
    identityPublicId: string;
    sessionPublicId: string;
    rawToken: string;
    expiresAt: Date;
  }> {
    this.chamadas += 1;
    if (this.chamadas % 2 === 0) {
      throw new AuthenticationFailedError("INVALID_PASSWORD");
    }
    return {
      identityPublicId: "66231e51-66fb-466d-af4f-ac7b925ca9ec",
      sessionPublicId: "22222222-2222-4222-8222-222222222222",
      rawToken: "token-sintetico",
      expiresAt: new Date(T0.getTime() + 3_600_000)
    };
  }
}

const politica = new LoginRateLimitPolicy({
  enabled: true,
  windowSeconds: JANELA_SEGUNDOS,
  maxAttemptsPerIp: TETO_IP,
  maxAttemptsPerIpIdentifier: TETO_IP_IDENTIFICADOR
});

interface Ambiente {
  readonly server: Server;
  readonly baseUrl: string;
  readonly contador: InMemoryLoginRateLimitStore;
  readonly auditoria: AuditoriaEmMemoria;
  avancar(segundos: number): void;
}

async function subir(
  loginService: unknown,
  opcoes: {
    store?: LoginRateLimitStore;
    habilitado?: boolean;
    politica?: LoginRateLimitPolicy;
    /**
     * Origem vista pelo limitador. Quando omitida, o app usa o
     * resolvedor REAL sobre o socket — o caminho de produção continua
     * exercitado por todos os outros testes.
     */
    ip?: string;
  } = {}
): Promise<Ambiente> {
  const contador = new InMemoryLoginRateLimitStore();
  const auditoria = new AuditoriaEmMemoria();
  let agora = T0;

  const app = createApp({
    loginService: loginService as unknown as LoginService,
    logoutService: {} as unknown as LogoutService,
    validateSessionService: {} as unknown as ValidateSessionService,
    sessionCookieConfig: { secure: false },
    loginRateLimitStore: opcoes.store ?? contador,
    loginRateLimitPolicy:
      opcoes.politica ??
      (opcoes.habilitado === false
        ? new LoginRateLimitPolicy({
            enabled: false,
            windowSeconds: JANELA_SEGUNDOS,
            maxAttemptsPerIp: TETO_IP,
            maxAttemptsPerIpIdentifier: TETO_IP_IDENTIFICADOR
          })
        : politica),
    loginRateLimitClock: () => agora,
    loginRateLimitAuditEventRepository: auditoria,
    ...(opcoes.ip !== undefined ? { loginRateLimitClientIpResolver: () => opcoes.ip as string } : {})
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("endereço inesperado do servidor de teste");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    contador,
    auditoria,
    avancar(segundos: number) {
      agora = new Date(agora.getTime() + segundos * 1000);
    }
  };
}

async function tentarLogin(baseUrl: string, email: string | undefined, senha = "senha-qualquer-1234"): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(email === undefined ? { password: senha } : { email, password: senha })
  });
}

describe("rate limit de login — o teto por (origem + identificador)", () => {
  let ambiente: Ambiente;
  let login: LoginQueSempreFalha;

  beforeEach(async () => {
    login = new LoginQueSempreFalha();
    ambiente = await subir(login);
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      ambiente.server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it("as tentativas dentro do teto passam e chegam ao login; a que estoura é barrada com 429", async () => {
    for (let i = 0; i < TETO_IP_IDENTIFICADOR; i += 1) {
      const res = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
      expect(res.status).toBe(401);
    }

    const barrada = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");

    expect(barrada.status).toBe(429);
    // O login nunca foi chamado na requisição barrada — nenhum Argon2id
    // é gasto depois que o teto estourou.
    expect(login.chamadas).toBe(TETO_IP_IDENTIFICADOR);
  });

  it("responde Retry-After coerente com a janela", async () => {
    for (let i = 0; i < TETO_IP_IDENTIFICADOR; i += 1) {
      await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
    }
    ambiente.avancar(10);

    const barrada = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");

    expect(barrada.status).toBe(429);
    expect(Number(barrada.headers.get("retry-after"))).toBe(JANELA_SEGUNDOS - 10);
  });

  it("passada a janela, o contador reinicia e o acesso volta a ser tentado", async () => {
    for (let i = 0; i < TETO_IP_IDENTIFICADOR + 1; i += 1) {
      await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
    }
    expect((await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid")).status).toBe(429);

    ambiente.avancar(JANELA_SEGUNDOS + 1);

    const depois = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
    expect(depois.status).toBe(401);
  });

  it("e-mails DIFERENTES não compartilham o contador apertado", async () => {
    for (let i = 0; i < TETO_IP_IDENTIFICADOR; i += 1) {
      await tentarLogin(ambiente.baseUrl, "primeira@example.invalid");
    }
    expect((await tentarLogin(ambiente.baseUrl, "primeira@example.invalid")).status).toBe(429);

    const outra = await tentarLogin(ambiente.baseUrl, "segunda@example.invalid");
    expect(outra.status).toBe(401);
  });

  it("o mesmo e-mail em caixas diferentes é o MESMO contador — normalização igual à do VO Email", async () => {
    for (let i = 0; i < TETO_IP_IDENTIFICADOR; i += 1) {
      await tentarLogin(ambiente.baseUrl, "Pessoa@Example.INVALID");
    }

    const mesmaPessoa = await tentarLogin(ambiente.baseUrl, "  pessoa@example.invalid  ");
    expect(mesmaPessoa.status).toBe(429);
  });
});

describe("rate limit de login — o teto por ORIGEM", () => {
  let ambiente: Ambiente;

  beforeEach(async () => {
    ambiente = await subir(new LoginQueSempreFalha());
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      ambiente.server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it("varrer muitos e-mails distintos da mesma origem esbarra no teto largo", async () => {
    for (let i = 0; i < TETO_IP; i += 1) {
      const res = await tentarLogin(ambiente.baseUrl, `pessoa${i}@example.invalid`);
      expect(res.status).toBe(401);
    }

    const barrada = await tentarLogin(ambiente.baseUrl, "pessoa-nova@example.invalid");
    expect(barrada.status).toBe(429);
  });

  it("requisição SEM e-mail ainda consome tentativa — não é caminho barato de escapar do limite", async () => {
    for (let i = 0; i < TETO_IP; i += 1) {
      await tentarLogin(ambiente.baseUrl, undefined);
    }

    const barrada = await tentarLogin(ambiente.baseUrl, undefined);
    expect(barrada.status).toBe(429);
  });
});

describe("rate limit de login — não cria enumeração de usuários", () => {
  it("e-mail inexistente e e-mail existente produzem exatamente a mesma resposta ao estourar", async () => {
    // O mesmo `loginService` responde 401 para os dois — o ponto é que a
    // decisão do limitador acontece ANTES dele, e não consulta
    // `identities` em momento nenhum.
    const ambiente = await subir(new LoginQueSempreFalha());
    try {
      const respostas: Array<{ status: number; corpo: unknown; retryAfter: string | null }> = [];
      for (const email of ["existe@example.invalid", "nao-existe@example.invalid"]) {
        for (let i = 0; i < TETO_IP_IDENTIFICADOR; i += 1) {
          await tentarLogin(ambiente.baseUrl, email);
        }
        const barrada = await tentarLogin(ambiente.baseUrl, email);
        respostas.push({
          status: barrada.status,
          corpo: await barrada.json(),
          retryAfter: barrada.headers.get("retry-after")
        });
      }

      const [primeira, segunda] = respostas;
      expect(primeira?.status).toBe(429);
      expect(segunda?.status).toBe(429);
      expect(primeira?.retryAfter).toBe(segunda?.retryAfter);
      // Envelope idêntico, exceto o correlation_id (que é por requisição).
      const semCorrelacao = (corpo: unknown): unknown => {
        const c = corpo as { error: Record<string, unknown> };
        const { correlation_id: _ignorado, ...resto } = c.error;
        return resto;
      };
      expect(semCorrelacao(primeira?.corpo)).toEqual(semCorrelacao(segunda?.corpo));
    } finally {
      await new Promise<void>((resolve, reject) =>
        ambiente.server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it("a mensagem não diz QUAL limite estourou", async () => {
    const ambiente = await subir(new LoginQueSempreFalha());
    try {
      for (let i = 0; i < TETO_IP_IDENTIFICADOR + 1; i += 1) {
        await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
      }
      const barrada = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
      const corpo = (await barrada.json()) as { error: { code: string; message: string } };

      expect(corpo.error.code).toBe("LOGIN_RATE_LIMITED");
      expect(corpo.error.message).not.toMatch(/IP|identificador|e-mail|email/i);
    } finally {
      await new Promise<void>((resolve, reject) =>
        ambiente.server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });
});

describe("rate limit de login — nada sensível é armazenado", () => {
  it("as chaves dos contadores são digests — nunca o e-mail nem o IP em claro", async () => {
    const ambiente = await subir(new LoginQueSempreFalha());
    try {
      await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid", "senha-secreta-do-teste");

      const chaves = ambiente.contador.chaves();
      expect(chaves.length).toBeGreaterThan(0);
      for (const chave of chaves) {
        expect(chave).toMatch(/^[0-9a-f]{64}$/);
        expect(chave).not.toContain("pessoa");
        expect(chave).not.toContain("127.0.0.1");
      }
      const serializado = JSON.stringify(chaves);
      expect(serializado).not.toContain("senha-secreta-do-teste");
    } finally {
      await new Promise<void>((resolve, reject) =>
        ambiente.server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it("o evento de bloqueio não carrega IP, e-mail, senha nem o digest", async () => {
    const ambiente = await subir(new LoginQueSempreFalha());
    try {
      for (let i = 0; i < TETO_IP_IDENTIFICADOR + 1; i += 1) {
        await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid", "senha-secreta-do-teste");
      }

      const bloqueios = ambiente.auditoria.eventos.filter((e) => e.eventType === "auth.rate-limit.blocked");
      expect(bloqueios.length).toBeGreaterThan(0);

      const serializado = JSON.stringify(bloqueios);
      expect(serializado).not.toContain("pessoa@example.invalid");
      expect(serializado).not.toContain("senha-secreta-do-teste");
      expect(serializado).not.toContain("127.0.0.1");
      for (const chave of ambiente.contador.chaves()) {
        expect(serializado).not.toContain(chave);
      }
      expect(bloqueios[0]?.payload).toEqual({
        scopeKind: "IP_IDENTIFIER",
        limit: TETO_IP_IDENTIFICADOR,
        windowSeconds: JANELA_SEGUNDOS
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        ambiente.server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it("o evento sai UMA vez por contador por janela — o limitador não vira amplificador do ataque", async () => {
    const ambiente = await subir(new LoginQueSempreFalha());
    try {
      // Muitas requisições barradas em sequência.
      for (let i = 0; i < TETO_IP + 5; i += 1) {
        await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
      }

      const bloqueios = ambiente.auditoria.eventos.filter((e) => e.eventType === "auth.rate-limit.blocked");
      const escopos = bloqueios.map((e) => (e.payload as { scopeKind: string }).scopeKind);

      // Um por escopo que estourou (IP_IDENTIFIER e depois IP), e não um
      // por requisição barrada.
      expect(bloqueios).toHaveLength(new Set(escopos).size);
      expect(bloqueios.length).toBeLessThanOrEqual(2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        ambiente.server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });
});

describe("rate limit de login — o que o sucesso limpa, e o que ele NÃO limpa", () => {
  /**
   * Decisão do Arquiteto na revisão final da fundação (ADR-034):
   *
   * - `IP_IDENTIFIER` protege contra adivinhação de senha → o sucesso
   *   REMOVE o contador daquela combinação;
   * - `IP` protege volume e CPU do Argon2id → o sucesso NÃO devolve
   *   nada, porque a tentativa custou o mesmo trabalho de qualquer jeito.
   */
  const chaves = (ip: string, email: string): { ipKey: string; ipIdentKey: string } => {
    const buckets = politica.buildBuckets({ clientIp: ip, identifier: email });
    const ipKey = buckets.find((b) => b.kind === "IP")?.key;
    const ipIdentKey = buckets.find((b) => b.kind === "IP_IDENTIFIER")?.key;
    if (ipKey === undefined || ipIdentKey === undefined) {
      throw new Error("política não produziu os dois escopos");
    }
    return { ipKey, ipIdentKey };
  };

  /** O `finish` da resposta dispara a limpeza; esperamos o próximo tick. */
  const proximoTick = async (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

  const derrubar = async (ambiente: Ambiente): Promise<void> =>
    new Promise<void>((resolve, reject) => ambiente.server.close((err) => (err ? reject(err) : resolve())));

  it("dez falhas para o mesmo (origem + identificador) barram a décima primeira", async () => {
    // Tetos REAIS de DEV/PRD (10 por origem+identificador, 60 por
    // origem) — o caso exigido na revisão, exercitado com os números
    // que vão para produção, e não com os tetos reduzidos do arquivo.
    const producao = new LoginRateLimitPolicy({
      enabled: true,
      windowSeconds: 900,
      maxAttemptsPerIp: 60,
      maxAttemptsPerIpIdentifier: 10
    });
    const login = new LoginQueSempreFalha();
    const ambiente = await subir(login, { politica: producao });
    try {
      for (let i = 0; i < 10; i += 1) {
        expect((await tentarLogin(ambiente.baseUrl, "vitima@example.invalid")).status).toBe(401);
      }

      const barrada = await tentarLogin(ambiente.baseUrl, "vitima@example.invalid");

      expect(barrada.status).toBe(429);
      // Nenhum Argon2id gasto na barrada.
      expect(login.chamadas).toBe(10);
    } finally {
      await derrubar(ambiente);
    }
  });

  it("o login válido limpa SOMENTE o contador (origem + identificador)", async () => {
    const ambiente = await subir(new LoginQueSempreAceita(), { ip: "198.51.100.7" });
    try {
      const { ipKey, ipIdentKey } = chaves("198.51.100.7", "pessoa@example.invalid");

      expect((await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid")).status).toBe(201);
      await proximoTick();

      expect(ambiente.contador.contagem(ipIdentKey)).toBe(0);
      expect(ambiente.contador.chaves()).not.toContain(ipIdentKey);
      // A tentativa bem-sucedida continua contabilizada na origem.
      expect(ambiente.contador.contagem(ipKey)).toBe(1);
      // E só o escopo apertado foi tocado.
      expect(ambiente.contador.escoposLimpos).toEqual(["IP_IDENTIFIER"]);
    } finally {
      await derrubar(ambiente);
    }
  });

  it("erros anteriores do mesmo identificador somem no sucesso, mas o contador de origem guarda todos", async () => {
    const login = new LoginQueAlterna();
    const ambiente = await subir(login, { ip: "198.51.100.8" });
    try {
      const { ipKey, ipIdentKey } = chaves("198.51.100.8", "pessoa@example.invalid");

      // chamada 1 = sucesso, 2 = falha, 3 = sucesso.
      expect((await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid")).status).toBe(201);
      await proximoTick();
      expect((await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid")).status).toBe(401);
      expect(ambiente.contador.contagem(ipIdentKey)).toBe(1);
      expect((await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid")).status).toBe(201);
      await proximoTick();

      expect(ambiente.contador.contagem(ipIdentKey)).toBe(0);
      expect(ambiente.contador.contagem(ipKey)).toBe(3);
    } finally {
      await derrubar(ambiente);
    }
  });

  it("quem tem credencial válida NÃO usa os próprios sucessos para reduzir o contador de origem", async () => {
    const ambiente = await subir(new LoginQueSempreAceita(), { ip: "198.51.100.9" });
    try {
      const { ipKey } = chaves("198.51.100.9", "pessoa@example.invalid");

      for (let i = 0; i < TETO_IP; i += 1) {
        expect((await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid")).status).toBe(201);
        await proximoTick();
      }
      expect(ambiente.contador.contagem(ipKey)).toBe(TETO_IP);

      // O teto de ORIGEM estourou mesmo com todos os logins corretos.
      const barrada = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
      expect(barrada.status).toBe(429);
    } finally {
      await derrubar(ambiente);
    }
  });

  it("alternar falha e sucesso não impede o contador de origem de atingir o teto", async () => {
    const login = new LoginQueAlterna();
    const ambiente = await subir(login, { ip: "198.51.100.10" });
    try {
      const { ipKey } = chaves("198.51.100.10", "pessoa@example.invalid");

      const status: number[] = [];
      for (let i = 0; i < TETO_IP; i += 1) {
        const res = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
        status.push(res.status);
        await proximoTick();
      }
      // Alternância de fato aconteceu — o teste não estaria provando
      // nada se todas as respostas fossem iguais.
      expect(new Set(status)).toEqual(new Set([201, 401]));
      expect(ambiente.contador.contagem(ipKey)).toBe(TETO_IP);

      const barrada = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
      expect(barrada.status).toBe(429);
      expect(login.chamadas).toBe(TETO_IP);
    } finally {
      await derrubar(ambiente);
    }
  });

  it("o sucesso de um identificador não limpa o contador apertado de OUTRO na mesma origem", async () => {
    const ambiente = await subir(new LoginQueAceitaSomente("pessoa@example.invalid"), { ip: "198.51.100.11" });
    try {
      const outro = chaves("198.51.100.11", "outra@example.invalid");

      // Uma tentativa falha da "outra" pessoa deixa contador apertado
      // dela em 1.
      expect((await tentarLogin(ambiente.baseUrl, "outra@example.invalid")).status).toBe(401);
      expect(ambiente.contador.contagem(outro.ipIdentKey)).toBe(1);

      // Um login CORRETO da primeira pessoa, na mesma origem.
      expect((await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid")).status).toBe(201);
      await proximoTick();

      // O contador da outra combinação sobrevive intacto.
      expect(ambiente.contador.contagem(outro.ipIdentKey)).toBe(1);
    } finally {
      await derrubar(ambiente);
    }
  });

  it("origens DIFERENTES não compartilham o contador de origem", async () => {
    const primeira = await subir(new LoginQueSempreFalha(), { ip: "203.0.113.1" });
    const segunda = await subir(new LoginQueSempreFalha(), { ip: "203.0.113.2" });
    try {
      for (let i = 0; i < TETO_IP; i += 1) {
        await tentarLogin(primeira.baseUrl, `pessoa${i}@example.invalid`);
      }
      expect((await tentarLogin(primeira.baseUrl, "mais-uma@example.invalid")).status).toBe(429);

      // Mesmos e-mails, origem diferente: contador próprio, ninguém
      // barrado por causa do vizinho.
      for (let i = 0; i < TETO_IP; i += 1) {
        expect((await tentarLogin(segunda.baseUrl, `pessoa${i}@example.invalid`)).status).toBe(401);
      }

      const chavesDaPrimeira = chaves("203.0.113.1", "pessoa0@example.invalid");
      const chavesDaSegunda = chaves("203.0.113.2", "pessoa0@example.invalid");
      expect(chavesDaPrimeira.ipKey).not.toBe(chavesDaSegunda.ipKey);
      expect(chavesDaPrimeira.ipIdentKey).not.toBe(chavesDaSegunda.ipIdentKey);
    } finally {
      await derrubar(primeira);
      await derrubar(segunda);
    }
  });

  it("com o teto de origem estourado, a resposta é a MESMA para quem existe e para quem não existe", async () => {
    // Aqui o login aceita qualquer um — ou seja, o primeiro e-mail
    // "existe" de verdade. Ainda assim, depois que o teto de origem
    // estoura, as duas respostas são indistinguíveis.
    const ambiente = await subir(new LoginQueSempreAceita(), { ip: "203.0.113.3" });
    try {
      for (let i = 0; i < TETO_IP; i += 1) {
        await tentarLogin(ambiente.baseUrl, "existe@example.invalid");
        await proximoTick();
      }

      const respostas: Array<{ status: number; corpo: unknown; retryAfter: string | null }> = [];
      for (const email of ["existe@example.invalid", "nao-existe@example.invalid"]) {
        const barrada = await tentarLogin(ambiente.baseUrl, email);
        respostas.push({
          status: barrada.status,
          corpo: await barrada.json(),
          retryAfter: barrada.headers.get("retry-after")
        });
      }

      const [comConta, semConta] = respostas;
      expect(comConta?.status).toBe(429);
      expect(semConta?.status).toBe(429);
      expect(comConta?.retryAfter).toBe(semConta?.retryAfter);
      const semCorrelacao = (corpo: unknown): unknown => {
        const c = corpo as { error: Record<string, unknown> };
        const { correlation_id: _ignorado, ...resto } = c.error;
        return resto;
      };
      expect(semCorrelacao(comConta?.corpo)).toEqual(semCorrelacao(semConta?.corpo));
    } finally {
      await derrubar(ambiente);
    }
  });
});

describe("rate limit de login — falhas e configuração", () => {
  it("contador indisponível FECHA (503), nunca deixa passar", async () => {
    const login = new LoginQueSempreFalha();
    const ambiente = await subir(login, { store: new ContadorIndisponivel() });
    try {
      const res = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");

      expect(res.status).toBe(503);
      const corpo = (await res.json()) as { error: { code: string } };
      expect(corpo.error.code).toBe("LOGIN_RATE_LIMIT_UNAVAILABLE");
      expect(login.chamadas).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        ambiente.server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it("desligado por configuração, o login passa direto — a escotilha existe e é explícita", async () => {
    const ambiente = await subir(new LoginQueSempreFalha(), { habilitado: false });
    try {
      for (let i = 0; i < TETO_IP + 5; i += 1) {
        const res = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
        expect(res.status).toBe(401);
      }
      expect(ambiente.contador.chaves()).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        ambiente.server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it("o logout (DELETE /current) NÃO consome orçamento de adivinhação de senha", async () => {
    const ambiente = await subir(new LoginQueSempreFalha());
    try {
      for (let i = 0; i < TETO_IP + 5; i += 1) {
        await fetch(`${ambiente.baseUrl}/api/v1/sessions/current`, { method: "DELETE" });
      }
      expect(ambiente.contador.chaves()).toHaveLength(0);

      const login = await tentarLogin(ambiente.baseUrl, "pessoa@example.invalid");
      expect(login.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) =>
        ambiente.server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });
});
