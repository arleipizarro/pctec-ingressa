-- Migration: 0015_add_user_access_profile
-- Direção: DOWN
--
-- Reverte access_profile para ENUM('ADMIN') — só seguro se nenhuma
-- linha com access_profile='USER' existir no momento da reversão
-- (MariaDB rejeita o MODIFY COLUMN se houver valor fora do novo ENUM).
-- Isso é uma restrição real e aceitável: reverter esta migration depois
-- de conceder USER a alguém exige antes revogar/remover esses acessos —
-- mesmo princípio de qualquer DOWN que reduz um domínio de valores já
-- em uso.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

ALTER TABLE application_accesses
  MODIFY COLUMN access_profile ENUM('ADMIN') NOT NULL COMMENT 'Nivel de acesso GLOBAL a aplicacao - nunca permissao fina de negocio do produto consumidor (ADR-007, ADR-028). Novos valores exigem ALTER TABLE futuro, deliberado.';
