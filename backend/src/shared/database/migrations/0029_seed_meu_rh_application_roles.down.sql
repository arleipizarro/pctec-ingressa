-- Migration: 0029_seed_meu_rh_application_roles
-- Direção: DOWN
--
-- Remove os quatro perfis do catálogo. FALHA, por desenho, se ainda
-- existir qualquer concessão apontando para eles: a FK de 0028 é
-- RESTRICT, e apagar um perfil concedido deixaria pessoas com uma
-- autorização que não se sabe mais o que significava. Revogue as
-- concessões primeiro.
--
-- Exatamente UMA instrução executável neste arquivo.

DELETE FROM application_roles WHERE application_public_id = '9a4e6d17-2c85-4b93-8e61-000000000001';
