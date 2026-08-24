-- Migration: 0020_create_import_batches
-- Direção: DOWN
--
-- `import_batch_items` tem FK para esta tabela (ver 0021). Se a 0021
-- ainda estiver aplicada, este DROP falha por integridade referencial —
-- correto: reverta 0021 primeiro, na ordem inversa de aplicação.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

DROP TABLE IF EXISTS import_batches;
