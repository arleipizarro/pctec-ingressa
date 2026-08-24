-- Migration: 0019_add_match_method_created_from_source
-- Direção: DOWN
--
-- Volta o ENUM aos 2 valores de 0016.
--
-- ATENÇÃO — PERDA DE DADO POSSÍVEL: se existir qualquer linha com
-- match_method = 'CREATED_FROM_SOURCE', o MariaDB em modo estrito
-- (sql_mode padrão deste projeto) REJEITA o ALTER com erro de truncamento
-- de dado. A migration falha e não é marcada como revertida — que é o
-- comportamento correto: reverter silenciosamente transformaria a
-- procedência das referências em string vazia.
--
-- Para reverter de fato: decida antes o que fazer com essas referências
-- (marcá-las SUPERSEDED, ou reclassificá-las deliberadamente), depois
-- rode este down.
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

ALTER TABLE identity_external_references
    MODIFY COLUMN match_method ENUM('MATCHED_BY_EMAIL','MATCHED_MANUAL_CONFIRMED') NOT NULL
        COMMENT 'Como o vinculo foi confirmado. Fechado a 2 valores - so referencias ja confirmadas sao persistidas. Nunca inferido pelo service: quem decide e sempre o chamador (CLI).';
