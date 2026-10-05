-- Migration: 0034_create_password_reset_tokens
-- Direção: DOWN
--
-- Apaga pedidos de redefinição ainda abertos: os links já enviados
-- deixam de funcionar, o que é seguro (o titular pede outro).

DROP TABLE IF EXISTS password_reset_tokens;
