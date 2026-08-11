/**
 * Cliente HTTP central — G4 (v0.7.x).
 *
 * Consome o mecanismo de autenticação REAL do backend (cookie
 * `ingressa_session`, `HttpOnly`) — este arquivo NUNCA lê, grava ou
 * manuseia o cookie de sessão diretamente (não pode: é `HttpOnly`).
 * `credentials: "include"` em TODA chamada é o único mecanismo de
 * "autenticação" que este cliente conhece — o browser anexa o cookie
 * automaticamente; o frontend nunca vê o token.
 *
 * Todas as chamadas usam `/api/...` (caminho relativo) — em dev, o
 * proxy do Vite (`vite.config.ts`) encaminha para o backend real em
 * `:3011`; em produção, pressupõe que o frontend é servido da MESMA
 * origem do backend (decisão operacional futura, fora de G4).
 */

const API_BASE = "/api/v1";

/** Espelha exatamente o envelope de erro real do backend (`mapDomainErrorToHttp.ts`/`createApp.ts`). */
export interface BackendErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly correlation_id: string | null;
    readonly details: readonly unknown[];
  };
}

function isBackendErrorBody(value: unknown): value is BackendErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const err = (value as { error: unknown }).error;
  return typeof err === "object" && err !== null && "code" in err && "message" in err;
}

/**
 * Erro HTTP com resposta do backend reconhecida (envelope
 * `{error:{code,...}}`). `code` é o único campo usado para decisão de
 * UI — nunca `message` (mensagens de erro do backend não são um
 * contrato estável para lógica de apresentação, só para log/debug).
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly correlationId: string | null;

  constructor(status: number, code: string, message: string, correlationId: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

/**
 * Falha de rede real (backend inalcançável, DNS, timeout) — DISTINTA
 * de `ApiError`. Nunca deve ser confundida com "sessão inválida": um
 * 401 real do backend vira `ApiError` (código `SESSION_INVALID`), uma
 * falha de rede vira `ApiNetworkError`. Misturar as duas faria a UI
 * mandar o usuário para a tela de login quando na verdade o backend
 * está fora do ar — por isso são tipos diferentes, tratados por telas
 * diferentes (task G4, "nunca transformar todo erro em senha
 * inválida").
 */
export class ApiNetworkError extends Error {
  constructor(cause: unknown) {
    super("Falha de rede ao contatar o backend.");
    this.name = "ApiNetworkError";
    this.cause = cause;
  }
}

export interface ApiFetchOptions {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Faz uma chamada autenticada ao backend real. Nunca lança para
 * status HTTP de erro do backend "silenciosamente" — sempre um
 * `ApiError` tipado, com `code` extraído do envelope real. Se o corpo
 * de erro não corresponder ao envelope esperado (não deveria
 * acontecer, mas defesa em profundidade), usa um código genérico
 * `UNKNOWN_ERROR` em vez de quebrar.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  let response: Response;
  try {
    const init: RequestInit = {
      method: options.method ?? "GET",
      credentials: "include",
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : {}
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    if (options.signal !== undefined) {
      init.signal = options.signal;
    }
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (cause) {
    // fetch só rejeita a Promise para falha de rede real (offline, DNS,
    // CORS bloqueado, backend inalcançável) — nunca para um status HTTP
    // de erro, que sempre resolve normalmente com response.ok=false.
    throw new ApiNetworkError(cause);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const parsedBody: unknown = contentType.includes("application/json") ? await response.json() : undefined;

  if (!response.ok) {
    if (isBackendErrorBody(parsedBody)) {
      throw new ApiError(response.status, parsedBody.error.code, parsedBody.error.message, parsedBody.error.correlation_id);
    }
    throw new ApiError(response.status, "UNKNOWN_ERROR", `Erro HTTP ${response.status} sem envelope reconhecido.`, null);
  }

  return parsedBody as T;
}
