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
