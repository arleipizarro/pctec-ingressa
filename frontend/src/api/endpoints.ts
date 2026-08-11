import { apiFetch } from "./client.js";

/**
 * Tipos e funções espelhando EXATAMENTE os 4 contratos reais auditados
 * no backend — G4. Nenhum campo além do que o backend realmente
 * retorna (nunca `legacyId`/`internalId`/`documentNumber`/CNPJ).
 */

// --- POST /api/v1/sessions (login) — sessionRoutes.ts ---
export interface LoginResponse {
  readonly session: { readonly publicId: string; readonly expiresAt: string };
  readonly identity: { readonly publicId: string };
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/sessions", { method: "POST", body: { email, password } });
}

// --- DELETE /api/v1/sessions/current (logout) — sessionRoutes.ts, confirmado existente ---
export async function logout(): Promise<void> {
  await apiFetch<void>("/sessions/current", { method: "DELETE" });
}

// --- GET /api/v1/me — meRoutes.ts ---
export interface MeResponse {
  readonly identity: { readonly publicId: string };
  readonly session: { readonly publicId: string };
}

export async function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/me", { method: "GET" });
}

// --- GET /api/v1/portal/context — portalContextRoutes.ts ---
export interface PortalOrganization {
  readonly publicId: string;
  readonly type: string;
  readonly legalName: string;
  readonly tradeName: string | null;
}

export interface PortalContextResponse {
  readonly identity: { readonly publicId: string };
  readonly organizations: readonly PortalOrganization[];
}

export async function fetchPortalContext(): Promise<PortalContextResponse> {
  return apiFetch<PortalContextResponse>("/portal/context", { method: "GET" });
}
