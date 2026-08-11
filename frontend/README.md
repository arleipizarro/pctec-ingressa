# Frontend

PCTEC Ingressa — frontend, G4 (v0.7.x): primeira experiência real
(login + shell autenticado + dashboard mínimo).

## Stack

Vite + React 18 + TypeScript (`strict`, mesmo rigor de tipagem do
backend) + React Router + Vitest + Testing Library.

## Rodando localmente

```bash
npm install
npm run dev
```

O proxy de dev (`vite.config.ts`) encaminha `/api` para o backend real
em `http://127.0.0.1:3011` — o backend precisa estar rodando
separadamente (`cd ../backend && npm run dev`).

Para o login funcionar sobre `http://` puro em desenvolvimento local, o
backend precisa de `SESSION_COOKIE_SECURE=false` no seu `.env` (o
default é `true`, pensado para produção com HTTPS) — o cookie de
sessão é `Secure` por padrão e o browser não o grava sobre HTTP simples
sem essa variável.

## Scripts

- `npm run dev` — servidor de desenvolvimento.
- `npm run build` — typecheck + build de produção (`dist/`).
- `npm run typecheck` — só typecheck, sem build.
- `npm test` — suíte de testes (Vitest).

## Escopo desta entrega (G4)

Login real (`POST /api/v1/sessions`), bootstrap via `GET /api/v1/me`,
contexto organizacional via `GET /api/v1/portal/context`, seleção de
Organization (0/1/2+), shell autenticado, dashboard mínimo, logout real
(`DELETE /api/v1/sessions/current`). Nenhuma autorização é recalculada
no frontend — todo o modelo de segurança (`Membership`,
`OrganizationRelationship`, `AND_DESCENDANTS`) já vem resolvido pelo
backend.
