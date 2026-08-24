-- Migration: 0021_create_import_batch_items
-- Direção: DOWN
--
-- Deve ser revertida ANTES de 0020 (FK para import_batches).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

DROP TABLE IF EXISTS import_batch_items;
