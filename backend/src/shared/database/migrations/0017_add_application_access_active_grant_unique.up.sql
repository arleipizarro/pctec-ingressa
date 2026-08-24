-- Migration: 0017_add_application_access_active_grant_unique
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: fundação do importador Helpdesk -> Ingressa (v0.8.x),
-- item 1 da task. Origem do achado: auditoria read-only do Helpdesk.
--
-- PROBLEMA QUE ESTA MIGRATION FECHA
--
-- `application_accesses` não tem NENHUMA constraint de unicidade sobre
-- (identity_public_id, application_public_id). A única proteção contra
-- acesso duplicado vive na aplicação:
-- `GrantApplicationAccessService` chama
-- `existsGrantedByIdentityApplicationAndProfile(...)` antes de inserir.
--
-- Dois furos reais nesse desenho:
--
--   1. A checagem inclui `access_profile`. Conceder USER e depois ADMIN
--      à MESMA Identity na MESMA Application passa pelas duas checagens
--      e produz DOIS acessos GRANTED simultâneos. A regra de negócio é
--      "um acesso ativo por identidade por aplicação" — o perfil é
--      atributo do acesso, não parte da identidade dele.
--
--   2. `exists()` seguido de `insert()` é TOCTOU: duas transações
--      concorrentes leem "não existe" e ambas inserem. Um importador em
--      lote é exatamente o cenário que dispara isso.
--
-- SOLUÇÃO — mesma técnica já usada em 0013/0016
--
-- Coluna VIRTUAL gerada + UNIQUE KEY sobre ela. InnoDB trata cada NULL
-- como distinto numa UNIQUE KEY, então:
--   - status = 'GRANTED'  -> chave = 'identity:application' -> no máximo 1
--   - status = 'REVOKED'  -> chave = NULL -> quantas linhas históricas
--                            forem necessárias, sem colidir entre si nem
--                            com a linha GRANTED
--
-- O `access_profile` fica DELIBERADAMENTE FORA da chave. Incluí-lo
-- reintroduziria exatamente o furo 1. Trocar de perfil passa a ser
-- revoke + grant na mesma transação — nunca dois GRANTED coexistindo.
--
-- Tamanho da coluna: CHAR(36) + ':' + CHAR(36) = 73 caracteres.
--
-- PREFLIGHT OBRIGATÓRIO ANTES DE APLICAR
--
-- Se já existirem duplicatas GRANTED, o ALTER falha com ER_DUP_ENTRY
-- (errno 1062) e a mensagem crua do MariaDB não diz QUAIS linhas
-- colidem. Rode antes:
--
--     node dist/cli/preflight-application-access-uniqueness.js
--
-- Ele lista cada (identity, application) duplicado e sai com código 1
-- quando encontra alguma. A regra de "uma instrução executável por
-- arquivo" (assertSingleStatement) impede embutir a verificação aqui —
-- por isso ela é um CLI próprio, e não um segundo statement.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).
--
-- NÃO EXECUTAR AUTOMATICAMENTE NESTA FATIA.

ALTER TABLE application_accesses
    ADD COLUMN active_grant_key VARCHAR(73) GENERATED ALWAYS AS (
        CASE WHEN status = 'GRANTED' THEN CONCAT(identity_public_id, ':', application_public_id) ELSE NULL END
    ) VIRTUAL
        COMMENT 'Coluna gerada, uso exclusivo de uk_app_access_active_grant abaixo - nunca lida/gravada diretamente pela aplicacao. NULL quando status != GRANTED. access_profile fica FORA da chave de proposito: a regra e um acesso ativo por identidade por aplicacao, e o perfil e atributo do acesso.',
    ADD UNIQUE KEY uk_app_access_active_grant (active_grant_key)
        COMMENT 'Garante, NO PROPRIO BANCO e sem janela de corrida (TOCTOU), no maximo 1 linha GRANTED por (identity_public_id, application_public_id). Linhas REVOKED tem active_grant_key NULL e nunca colidem. Troca de perfil = revoke + grant transacional.';
