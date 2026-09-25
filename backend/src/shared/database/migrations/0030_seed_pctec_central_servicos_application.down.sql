-- Migration: 0030_seed_pctec_central_servicos_application
-- Direção: DOWN
--
-- Remove a Application `PCTEC_CENTRAL_SERVICOS` do catálogo, por
-- `public_id` (ADR-021), nunca por `code`. Falha por RESTRICT se houver
-- acesso, perfil, código SSO ou asserção referenciando esta linha — o
-- comportamento desejado: revogue deliberadamente antes.
--
-- Exatamente UMA instrução executável neste arquivo.

DELETE FROM applications WHERE public_id = '7e2d4c86-3b51-4f9a-8d20-000000000001';
