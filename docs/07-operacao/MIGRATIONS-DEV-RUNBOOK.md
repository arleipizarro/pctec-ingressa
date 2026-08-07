# PCTEC Ingressa — Runbook: integração MariaDB em DEV (v0.4.2)

Este documento é o plano operacional para a **primeira execução real** das
migrations do backend contra o banco `pctec_ingressa_dev`, no servidor DEV.

**Nenhum passo deste runbook foi executado como parte da entrega v0.4.2.**
Esta entrega só prepara código, scripts e este plano — a implementação
(`feature/mariadb-integration-v0.4.2`) não tem acesso de rede ao servidor
DEV, por desenho do ambiente em que foi construída.

> Este arquivo estava anteriormente em `docs/05-operacao/` — movido para
> `docs/07-operacao/` por decisão do Platform Architect. Nenhuma cópia
> permanece no caminho antigo.

## Antes de começar

- Quem executa este runbook precisa acesso real ao servidor DEV (fora do
  escopo desta entrega).
- **Nunca digite senha na linha de comando** onde ela fique em
  `history`/`ps aux`; prefira variável de ambiente exportada na sessão
  (`export DB_PASSWORD=...`) ou um cofre de segredos.
- Este runbook assume dois atores distintos — ver seção "Usuários e
  privilégios" abaixo.

## Usuários e privilégios (aprovado pelo Product Owner / Platform Architect)

| Usuário | Uso | Privilégios |
|---|---|---|
| `pctec_ingressa_dev_migrator` | Só para rodar `npm run migrate:*` (aplicar/reverter schema) | Schema (`CREATE`, `ALTER`, `DROP`, `INDEX`) + dados (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) — **apenas em `pctec_ingressa_dev`** |
| `pctec_ingressa_dev_app` | Runtime do backend (`node dist/server.js`) | Somente `SELECT`, `INSERT`, `UPDATE`, `DELETE` sobre `pctec_ingressa_dev.*` — **sem** `CREATE`, `ALTER`, `DROP`, `GRANT`, sem acesso a bancos de outros produtos |

O processo do backend em execução contínua nunca tem poder de alterar
schema — se comprometido ou com um bug, o blast radius fica limitado a
dados, nunca à estrutura do banco. O usuário `_migrator` só é usado
manualmente, por um operador, no momento de aplicar uma migration —
nunca fica configurado como variável de ambiente de um processo do
backend em execução contínua.

Nenhum dos dois usuários tem `CREATE DATABASE`, `DROP DATABASE`, `GRANT`,
ou acesso a qualquer banco além de `pctec_ingressa_dev`. Só o
administrador de banco (DBA — Fase B) tem esses privilégios, e só os usa
uma vez, manualmente.

### Responsabilidades

- **DBA (administrador de banco):** cria o banco, cria os dois usuários,
  concede os privilégios acima. Nunca roda migrations diretamente — só
  prepara o terreno para a Fase C.
- **Aplicação/operador de migration:** usa `pctec_ingressa_dev_migrator`
  exclusivamente para `npm run migrate:*` (Fases C–F). Usa
  `pctec_ingressa_dev_app` para o smoke test do backend (Fase G) e para
  qualquer execução real do serviço depois.

## Fase A — pré-check

1. Confirmar hostname do MariaDB de destino (nunca hardcoded em código —
   só em `.env` local, nunca versionado).
2. Confirmar versão: `SELECT VERSION();` → esperado `10.11.x`.
3. Confirmar que `pctec_ingressa_dev` **não existe ainda**, ou existe e
   está vazio:
   ```sql
   SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'pctec_ingressa_dev';
   SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pctec_ingressa_dev';
   ```
4. Confirmar qual usuário administrador vai executar a Fase B (nunca
   `root` se houver um usuário de DBA mais restrito disponível).
5. Confirmar que backup não é necessário (banco novo/vazio — nada a
   perder).
6. Confirmar branch e commit implantados:
   ```bash
   git rev-parse HEAD
   ```
7. Confirmar `NODE_ENV` do ambiente de destino — se for `production`,
   **os comandos destrutivos (`migrate:down`/`migrate:down-all`) serão
   recusados automaticamente pelo CLI, sem exceção** (ver seção "Gate
   duplo de rollback" abaixo). `pctec_ingressa_dev` normalmente roda com
   `NODE_ENV=development`, mas confirme antes de assumir.

## Fase B — criação (DBA)

Executado **apenas pelo DBA**, uma única vez:

```sql
CREATE DATABASE pctec_ingressa_dev
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_520_ci;

CREATE USER 'pctec_ingressa_dev_migrator'@'%' IDENTIFIED BY '<senha forte, fora deste arquivo>';
GRANT CREATE, ALTER, DROP, INDEX, SELECT, INSERT, UPDATE, DELETE
  ON pctec_ingressa_dev.* TO 'pctec_ingressa_dev_migrator'@'%';

CREATE USER 'pctec_ingressa_dev_app'@'%' IDENTIFIED BY '<senha forte, diferente, fora deste arquivo>';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON pctec_ingressa_dev.* TO 'pctec_ingressa_dev_app'@'%';

FLUSH PRIVILEGES;
```

Validar charset/collation:
```sql
SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'pctec_ingressa_dev';
-- Esperado: utf8mb4 / utf8mb4_unicode_520_ci
```

## Fase C — migrations up

Com `DB_USER=pctec_ingressa_dev_migrator` no `.env` (nunca versionado):

```bash
cd backend
npm run build
npm run migrate:status      # confere que as 4 aparecem "pending"
npm run migrate:up
npm run migrate:status      # confere que as 4 aparecem "applied", com checksum preenchido
```

Validar estruturalmente:
```sql
SELECT * FROM schema_migrations ORDER BY applied_at;
-- 4 linhas: 0001..0004, todas com checksum preenchido (banco novo, sem legado)

SHOW CREATE TABLE identities;
SHOW CREATE TABLE audit_events;
```

### Convenção de arquivos SQL (uma instrução por arquivo)

Cada `.up.sql`/`.down.sql` deve conter **exatamente uma instrução SQL
executável**. O runner (`assertSingleStatement` em `MigrationRunner.ts`)
valida isso ANTES de adquirir lock ou conexão — se algum arquivo violar a
regra, o comando inteiro falha imediatamente, sem executar nada, com
`MigrationMultipleStatementsError` identificando qual migration e fase
(`up`/`down`). A checagem é ciente de aspas: um `;` dentro de uma string
literal (ex.: um `COMMENT '...'` com pontuação) nunca conta como
separador — só um `;` fora de qualquer string.

`multipleStatements` **nunca é habilitado** na conexão mysql2/promise
usada pelo runner (nem globalmente, nem por operação) — se uma migration
legitimamente precisar de mais de uma instrução DDL relacionada, a
convenção é usar múltiplas cláusulas dentro de UM único `ALTER TABLE`
(como a migration `0004` faz, com dois `ADD COLUMN` na mesma instrução),
nunca duas instruções separadas por `;` no mesmo arquivo. Se isso não for
suficiente para um caso futuro, uma mudança de configuração da conexão
precisa ser proposta e aprovada explicitamente antes de implementada —
não é assumida por este runner.

### Lock na mesma conexão física

`GET_LOCK`, a aplicação de cada migration, a leitura/escrita de
`schema_migrations` e `RELEASE_LOCK` rodam **todos sobre a mesma conexão
física**, adquirida uma única vez por operação (`pool.getConnection()`)
e liberada ao final — nunca uma conexão diferente obtida no meio do
caminho. Isso é essencial porque `GET_LOCK`/`RELEASE_LOCK` do MariaDB têm
escopo de **sessão/conexão**: se o lock fosse adquirido numa conexão e as
migrations executadas via `pool.execute()` (que serve de qualquer
conexão livre do pool), o lock não protegeria nada de verdade contra dois
runners concorrentes. `RELEASE_LOCK` só é chamado se `GET_LOCK` teve
sucesso; a conexão em si é sempre devolvida ao pool, mesmo se o lock
nunca tiver sido obtido.

### Falha parcial de DDL — procedimento de diagnóstico manual

MariaDB/InnoDB dá **commit implícito em DDL** — não há rollback
transacional de uma migration que falhe no meio da execução. Este runner
nunca promete nem finge reverter automaticamente o que já tiver sido
alterado.

Se `migrate:up` falhar no meio (erro `MigrationExecutionError`, fase
`up` ou `record`):

1. **Não reexecute `migrate:up` automaticamente** — o CLI não tenta de
   novo sozinho, e você também não deve, sem investigar primeiro.
2. A mensagem de erro informa `migrationId` e a fase (`up` = o SQL da
   migration falhou durante a execução; `record` = o SQL rodou, mas o
   registro em `schema_migrations` falhou depois — cenário mais
   perigoso, porque o schema já mudou sem estar registrado).
3. Inspecione manualmente o schema real (`SHOW CREATE TABLE ...`,
   `SELECT * FROM schema_migrations`) e compare com o que a migration
   deveria ter feito.
4. Se a fase foi `up` e nada foi alterado (erro de sintaxe, por
   exemplo): corrija a migration, rode `migrate:status` para confirmar
   que ainda aparece `pending`, então tente `migrate:up` de novo.
5. Se a fase foi `record` (schema alterado, não registrado): registre
   manualmente a linha em `schema_migrations` (com o checksum correto,
   calculável via `sha256sum` do arquivo `.up.sql`) **ou** reverta
   manualmente a alteração de schema antes de tentar de novo — nunca
   deixe o banco num estado "alterado mas não registrado" sem decidir
   qual dos dois caminhos seguir.
6. O lock já foi liberado automaticamente (mesmo em erro) — não é
   necessário `RELEASE_LOCK` manual.
7. A mensagem de erro do runner **nunca inclui o SQL completo** da
   migration (só `migrationId`/fase) — se precisar do SQL para
   diagnóstico, leia o arquivo `.up.sql` correspondente diretamente.

## Fase D — idempotência

```bash
npm run migrate:up
```
Esperado: `Aplicadas: (nenhuma)` / `Já aplicadas: 0001_..., 0002_..., 0003_..., 0004_...`.
Zero alterações estruturais.

## Fase E — rollback

### Gate duplo de rollback (obrigatório)

`migrate:down`/`migrate:down-all` só executam de verdade quando **as
duas condições abaixo estiverem presentes simultaneamente**:

1. o argumento `--yes`;
2. a variável de ambiente `MIGRATIONS_ALLOW_DESTRUCTIVE=true`.

Sem qualquer uma das duas, o comando mostra o preview do que seria
revertido e sai com código de saída `1`, sem alterar nada.

**Proibição em produção:** se `NODE_ENV=production`, o comando recusa
**sempre**, mesmo com `--yes` e `MIGRATIONS_ALLOW_DESTRUCTIVE=true`
presentes — sai com código `2` e uma mensagem explícita. Não há bypass
para este caso nesta versão do CLI.

```bash
MIGRATIONS_ALLOW_DESTRUCTIVE=true npm run migrate:down-all -- --yes    # preview + execução real, em development
npm run migrate:down-all                                              # preview apenas — nenhum dos dois gates presente
```

Validar:
```sql
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pctec_ingressa_dev';
-- Esperado: nenhuma tabela do Ingressa restante.
```
**Nunca `DROP DATABASE pctec_ingressa_dev`** — só as tabelas do produto,
via o `.down.sql` de cada migration. Nenhum script desta entrega executa
`DROP DATABASE` automaticamente.

## Fase F — reaplicação

```bash
npm run migrate:up
npm run migrate:status
```
Esperado: as 4 migrations `applied` novamente, banco íntegro e vazio.

## Fase G — smoke test

Sem PM2, usando `pctec_ingressa_dev_app` (nunca o usuário `_migrator`
para o runtime):
```bash
npm run build
DB_HOST=<host-dev> DB_PORT=3306 DB_NAME=pctec_ingressa_dev DB_USER=pctec_ingressa_dev_app DB_PASSWORD=<senha> \
  HOST=127.0.0.1 PORT=3011 node dist/server.js

curl -i http://127.0.0.1:3011/health
```
Esperado: `200`, payload exato já validado na v0.4.1. **`/health` continua
sendo um liveness check simples, independente de banco** — decisão
confirmada pelo Platform Architect nesta revisão; nenhum readiness check
de dependência de banco foi implementado nesta fatia.

Encerrar o processo com `Ctrl+C`/`SIGTERM` ao final.
