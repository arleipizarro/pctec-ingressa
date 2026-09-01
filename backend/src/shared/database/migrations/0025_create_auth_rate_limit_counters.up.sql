-- Migration: 0025_create_auth_rate_limit_counters
-- Direção: UP
-- Motor: MariaDB 10.11, InnoDB, utf8mb4, utf8mb4_unicode_520_ci
--
-- Referência: decisão D8 da fundação PCTEC Meu RH — proteção contra
-- força bruta em POST /api/v1/sessions (ADR-034).
--
-- PROBLEMA QUE ESTA MIGRATION FECHA
--
-- `POST /api/v1/sessions` não tinha NENHUM limite de tentativas. Cada
-- requisição custa um Argon2id completo (o custo existe justamente para
-- ser alto), então a ausência de limite é ao mesmo tempo um convite à
-- adivinhação de senha e um vetor de esgotamento de CPU. Antes de
-- ampliar o Ingressa para os funcionários — muito mais gente, muito mais
-- superfície — isso precisava fechar.
--
-- POR QUE MARIADB, E NÃO REDIS OU MEMÓRIA DO PROCESSO
--
-- Auditoria do ambiente antes de decidir:
--   - `redis-server`/`redis-cli`: não instalados;
--   - serviço `redis`/`redis-server`: inativo;
--   - `redis`/`ioredis` em package.json: ausente em TODOS os produtos
--     do parque;
--   - Ingressa em PM2: `exec_mode: fork`, `instances: 1` hoje.
--
-- Memória do processo foi DESCARTADA, e não adiada: um contador local
-- deixa de ser proteção no dia em que subirem dois workers (o teto vira
-- "limite × workers", sem nenhum sinal de que a garantia mudou) e é
-- zerado por todo `pm2 restart`. A task é explícita em não aceitar isso
-- como garantia definitiva.
--
-- Redis exigiria autorização do Arquiteto para novo componente de
-- infraestrutura — e não é necessário: o MariaDB já É o ponto de
-- coordenação compartilhado deste sistema (sessões, códigos de
-- autorização de uso único, chaves únicas de concorrência). Um contador
-- por tentativa de login é escrita pequena e indexada por chave
-- primária, na mesma ordem de grandeza do que o próprio login já faz.
-- Nenhum componente novo, e o desenho já é compatível com execução
-- distribuída.
--
-- O QUE ESTA TABELA NUNCA GUARDA
--
-- `bucket_key` é o SHA-256 do escopo — nunca o IP, nunca o e-mail. A
-- tabela precisa saber que duas tentativas vieram do mesmo lugar; não
-- precisa saber de onde. Em particular, ela JAMAIS é uma lista de
-- e-mails que tentaram entrar. Senha e token não passam nem perto.
--
-- `scope_kind` é diagnóstico: diz se o contador é por origem ou por
-- origem+identificador. Não identifica ninguém.
--
-- ATOMICIDADE
--
-- O incremento é um único `INSERT ... ON DUPLICATE KEY UPDATE` sob trava
-- de linha do InnoDB — inclusive o reinício da janela expirada acontece
-- dentro da MESMA instrução, então não existe intervalo entre "expirou"
-- e "recomeçou" para duas requisições disputarem.
--
-- RETENÇÃO
--
-- Linhas de janelas antigas não são apagadas automaticamente: o
-- `ON DUPLICATE KEY UPDATE` reaproveita a linha do mesmo escopo, mas
-- escopos que nunca mais voltam ficam. A limpeza é uma rotina
-- OPERACIONAL, por idade de `window_started_at`, servida pelo índice
-- `idx_auth_rate_limit_window` — o comando exato está no ADR-034, e
-- deliberadamente não aqui: migration é mudança de schema, não script
-- de manutenção.
--
-- Remover contador antigo é seguro por construção: uma janela expirada
-- já reiniciaria na próxima tentativa de qualquer forma, e a linha não
-- guarda nada além de uma contagem.
--
-- ORDEM DE IMPLANTAÇÃO
--
-- O limitador falha FECHADO (503) quando não consegue ler o contador.
-- Portanto esta migration precisa ser aplicada ANTES de subir o build
-- que a usa — a ordem já prevista no runbook de migrations. A escotilha,
-- se algo der errado, é `LOGIN_RATE_LIMIT_ENABLED=false`.
--
-- Exatamente UMA instrução executável neste arquivo (assertSingleStatement).

CREATE TABLE IF NOT EXISTS auth_rate_limit_counters (
    bucket_key            CHAR(64)      NOT NULL
        COMMENT 'SHA-256 (hex) do escopo da tentativa. NUNCA o IP nem o e-mail em claro - esta tabela jamais e uma lista de quem tentou entrar.',
    scope_kind            ENUM('IP','IP_IDENTIFIER') NOT NULL
        COMMENT 'Se o contador e por origem (teto largo, contra varredura) ou por origem+identificador (teto apertado, contra adivinhacao de senha). Diagnostico apenas - nao identifica ninguem.',
    window_started_at     DATETIME(3)   NOT NULL
        COMMENT 'Inicio da janela vigente. Reiniciado na propria instrucao de incremento quando a janela expirou, sem passo separado de expiracao.',
    attempt_count         INT UNSIGNED  NOT NULL
        COMMENT 'Tentativas registradas na janela vigente. Login bem-sucedido estorna 1 (piso zero) para que uso legitimo nao consuma orcamento.',
    updated_at            DATETIME(3)   NOT NULL,
    PRIMARY KEY (bucket_key),
    KEY idx_auth_rate_limit_window (window_started_at)
        COMMENT 'Serve a limpeza operacional por idade (DELETE ... WHERE window_started_at < ...), nunca uma decisao de autorizacao.'
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_520_ci
  COMMENT = 'Contadores compartilhados de tentativa de login (D8, ADR-034) - coordenacao entre workers, nunca memoria de processo';
