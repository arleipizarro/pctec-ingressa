-- Migration: 0033_seed_portal_application_roles
-- Direção: DOWN
--
-- Remove o perfil do catálogo. FALHA, por desenho, se ainda existir
-- qualquer concessão apontando para ele (FK RESTRICT de 0028): apagar um
-- perfil concedido deixaria pessoas com uma autorização que não se sabe
-- mais o que significava. Revogue as concessões primeiro.
--
-- Exatamente UMA instrução executável neste arquivo.

DELETE FROM application_roles WHERE application_public_id = '3f9c1a2e-7d4b-4e5a-9c3f-000000000001' AND code = 'PORTAL_ADMIN_GLOBAL';
