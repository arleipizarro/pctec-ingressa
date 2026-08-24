/**
 * Códigos de `Application` conhecidos pela própria plataforma —
 * centralizados aqui para nunca espalhar a string mágica
 * `"PCTEC_INGRESSA"` pelo código (task v0.5.0, seção 6).
 *
 * `PCTEC_INGRESSA` representa a própria plataforma Ingressa como uma
 * `Application` do catálogo — necessário para que o Ingressa possa
 * conceder acesso administrativo a si mesmo (bootstrap, v0.5.0 Fase B),
 * usando o mesmo mecanismo genérico de `ApplicationAccess` que qualquer
 * outra aplicação do ecossistema usaria.
 */
export const PCTEC_INGRESSA_APPLICATION_CODE = "PCTEC_INGRESSA" as const;

export const PCTEC_INGRESSA_APPLICATION_NAME = "PCTEC Ingressa" as const;

/**
 * `public_id` técnico determinístico da Application `PCTEC_INGRESSA` —
 * gerado uma única vez (UUID v4 aleatório, não derivado de nenhum dado),
 * documentado aqui e fixado por migration (ver
 * `0007_seed_pctec_ingressa_application.up.sql`).
 *
 * Determinístico ao invés de gerado em runtime porque: (1) é metadado
 * técnico estável da plataforma, não dado pessoal; (2) precisa ser o
 * MESMO valor entre ambientes (dev/test/produção) para que testes de
 * integração e o CLI de bootstrap administrativo possam referenciá-lo sem
 * precisar consultar o banco primeiro; (3) evita uma corrida teórica onde
 * duas migrations rodando em ambientes diferentes gerassem
 * `public_id`s diferentes para "a mesma" aplicação conceitual.
 */
export const PCTEC_INGRESSA_APPLICATION_PUBLIC_ID = "0b13f6f0-8f3a-4a1e-9c2d-000000000001" as const;

/**
 * `PCTEC_PORTAL` — G3 (v0.6.x): Application distinta para o Portal do
 * Cliente, conforme decisão já registrada em ADR-031 §1 ("cada produto
 * consumidor possuir Application própria") — nunca reaproveita
 * `PCTEC_INGRESSA`. Mesmo princípio de metadado técnico estável e
 * `public_id` determinístico já usado acima.
 */
export const PCTEC_PORTAL_APPLICATION_CODE = "PCTEC_PORTAL" as const;

export const PCTEC_PORTAL_APPLICATION_NAME = "PCTEC Portal" as const;

/**
 * `public_id` técnico determinístico da Application `PCTEC_PORTAL` —
 * gerado uma única vez (UUID v4, não derivado de nenhum dado),
 * documentado aqui e fixado por migration (ver
 * `0014_seed_pctec_portal_application.up.sql`). Mesmo raciocínio de
 * `PCTEC_INGRESSA_APPLICATION_PUBLIC_ID` acima — deliberadamente
 * diferente desse valor.
 */
export const PCTEC_PORTAL_APPLICATION_PUBLIC_ID = "3f9c1a2e-7d4b-4e5a-9c3f-000000000001" as const;

/**
 * `PCTEC_HELPDESK` — v0.8.x: Application própria do Helpdesk, pelo mesmo
 * princípio de ADR-031 §1 já aplicado ao Portal ("cada produto consumidor
 * possuir Application própria"). Nunca reaproveita `PCTEC_PORTAL`: um
 * usuário do Helpdesk não passa a ter acesso ao Portal por tabela
 * nenhuma, nem o contrário.
 *
 * `public_id` determinístico pelo mesmo raciocínio dos dois acima —
 * metadado técnico estável, igual entre ambientes, fixado por migration
 * (`0018_seed_pctec_helpdesk_application.up.sql`). Valor deliberadamente
 * diferente dos outros dois.
 */
export const PCTEC_HELPDESK_APPLICATION_CODE = "PCTEC_HELPDESK" as const;

export const PCTEC_HELPDESK_APPLICATION_NAME = "PCTEC Helpdesk" as const;

export const PCTEC_HELPDESK_APPLICATION_PUBLIC_ID = "5c7a2b91-1e6d-4f38-b7a4-000000000001" as const;
