-- Migration: 0024_add_identity_external_reference_active_binding_unique
-- Direção: DOWN
--
-- Remove o índice único e a coluna gerada, nesta ordem, numa única
-- instrução ALTER. Operação segura e sem perda: `active_binding_flag` é
-- derivada — nenhum dado próprio é armazenado nela, e nenhuma linha de
-- `identity_external_references` é tocada.
--
-- Depois deste down, a invariante "no máximo 1 referência ACTIVE por
-- (identity_public_id, system_code, entity_type)" volta a depender
-- apenas da checagem otimista da aplicação — e, sob concorrência, deixa
-- de existir. A direção de resolução Identity→legado passa a poder
-- encontrar duas candidatas; o service RECUSA (409
-- IDENTITY_EXTERNAL_REFERENCE_AMBIGUOUS) em vez de escolher, então o
-- efeito de reverter é indisponibilidade da resolução para a chave
-- afetada, nunca resposta errada.

ALTER TABLE identity_external_references
    DROP INDEX uk_id_ext_ref_active_binding,
    DROP COLUMN active_binding_flag;
