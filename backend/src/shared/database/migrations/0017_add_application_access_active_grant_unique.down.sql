-- Migration: 0017_add_application_access_active_grant_unique
-- Direção: DOWN
--
-- Remove o índice único e a coluna gerada, nesta ordem, numa única
-- instrução ALTER. Operação segura e sem perda: `active_grant_key` é
-- derivada — nenhum dado próprio é armazenado nela, e nenhuma linha de
-- `application_accesses` é tocada.
--
-- Depois deste down, a proteção volta a depender apenas do
-- `exists()+insert` da aplicação, com os dois furos descritos no up.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

ALTER TABLE application_accesses
    DROP INDEX uk_app_access_active_grant,
    DROP COLUMN active_grant_key;
