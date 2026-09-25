-- Migration: 0031_seed_central_servicos_application_roles
-- Direção: DOWN
--
-- Remove os dois perfis. FALHA por desenho (FK RESTRICT de 0028) se
-- ainda houver concessão apontando para eles: revogue primeiro.
--
-- Exatamente UMA instrução executável neste arquivo.

DELETE FROM application_roles WHERE application_public_id = '7e2d4c86-3b51-4f9a-8d20-000000000001';
