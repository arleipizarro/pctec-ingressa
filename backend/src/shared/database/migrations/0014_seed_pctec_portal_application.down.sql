-- Migration: 0014_seed_pctec_portal_application
-- Direção: DOWN
--
-- Remove exclusivamente a linha semeada por esta migration (identificada
-- pelo `public_id` técnico determinístico), nunca por `code` isolado —
-- mesmo raciocínio de risco já documentado em `0007_seed_pctec_ingressa_application.down.sql`.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

DELETE FROM applications WHERE public_id = '3f9c1a2e-7d4b-4e5a-9c3f-000000000001';
