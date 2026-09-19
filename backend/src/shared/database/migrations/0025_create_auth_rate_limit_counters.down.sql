-- Migration: 0025_create_auth_rate_limit_counters
-- Direção: DOWN
--
-- Remove a tabela de contadores. Nenhum dado de negócio é perdido: as
-- linhas são contadores efêmeros, derivados de tentativas, e uma janela
-- expirada reiniciaria sozinha na próxima tentativa de qualquer forma.
--
-- ATENÇÃO OPERACIONAL: com a tabela ausente e
-- `LOGIN_RATE_LIMIT_ENABLED=true`, o limitador falha FECHADO e
-- `POST /api/v1/sessions` passa a responder 503 — de propósito, para que
-- "sem proteção" nunca seja um estado silencioso. Reverter esta
-- migration exige, na mesma janela, desligar o limitador por
-- configuração.

DROP TABLE IF EXISTS auth_rate_limit_counters;
