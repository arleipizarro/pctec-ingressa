-- Migration: 0030_seed_pctec_central_servicos_application
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: ADR-031 §1 ("cada produto consumidor possui Application
-- própria"). Mesmo padrão de 0007, 0014, 0018 e 0026.
--
-- `PCTEC_CENTRAL_SERVICOS` é a Application da PCTEC Central de Serviços
-- N1 (repositório `pctec-servicos`). Registrar a Application NÃO concede
-- acesso a ninguém: nenhuma linha de `application_accesses` nasce aqui.
--
-- public_id determinístico pelo mesmo raciocínio de 0007/0014/0018/0026:
-- metadado técnico estável (não dado pessoal), igual entre ambientes.
-- UUID v4 gerado uma única vez, não derivado de dado.
--
-- NATUREZA: CONFIGURAÇÃO DE PLATAFORMA, NÃO DADO DE LOTE.
--
-- Idempotência é do MigrationRunner; estado divergente pré-existente
-- deve FALHAR (ER_DUP_ENTRY), nunca ser mascarado.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).

INSERT INTO applications (public_id, code, name, status, version, created_at, updated_at)
VALUES ('7e2d4c86-3b51-4f9a-8d20-000000000001', 'PCTEC_CENTRAL_SERVICOS', 'PCTEC Central de Serviços', 'ACTIVE', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));
