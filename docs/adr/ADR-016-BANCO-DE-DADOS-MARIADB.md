# ADR-016 — Banco de dados relacional: MariaDB

## Contexto

O escopo inicial desta entrega (v0.2.0 — Domain Foundation) assumiu MySQL
como motor relacional para `pctec_ingressa`, com base na instrução textual
recebida para esta fase. Já o `SAD.md` vigente (v0.1.0) citava MariaDB. O
documento `MODELO-RELACIONAL-PROPOSTO.md` desta entrega havia registrado
essa divergência como pendente de decisão.

O Product Owner (Arlei Pizarro) confirmou diretamente, em revisão desta
entrega, que o motor de banco de dados é **MariaDB**, apresentando a versão
já disponível no ambiente: `10.11.14-MariaDB-0ubuntu0.24.04.1`, Ubuntu
24.04.

## Decisão

O banco de dados relacional oficial do PCTEC Ingressa é **MariaDB
10.11**, sobre Ubuntu 24.04, engine InnoDB. Esta decisão corrige o escopo
textual desta entrega (que citava MySQL) e confirma o que já constava no
`SAD.md` desde a v0.1.0. Não há mais divergência entre os documentos.

## Nota de atualização (revisão do Platform Architect)

Após a aprovação da correção de motor (MySQL → MariaDB 10.11), o Platform
Architect determinou a execução de uma verificação de capacidade de
collation no servidor DEV, sem criação ou alteração de banco:

```
mariadb -u root -p -e "
SELECT VERSION();
SHOW COLLATION
WHERE Collation IN (
  'utf8mb4_uca1400_ai_ci',
  'utf8mb4_unicode_520_ci',
  'utf8mb4_general_ci'
);
"
```

Resultado obtido no servidor DEV:

```
VERSION(): 10.11.14-MariaDB-0ubuntu0.24.04.1

+------------------------+---------+------+---------+----------+---------+
| Collation              | Charset | Id   | Default | Compiled | Sortlen |
+------------------------+---------+------+---------+----------+---------+
| utf8mb4_general_ci     | utf8mb4 |   45 | Yes     | Yes      |       1 |
| utf8mb4_unicode_520_ci | utf8mb4 |  246 |         | Yes      |       8 |
+------------------------+---------+------+---------+----------+---------+
```

`utf8mb4_uca1400_ai_ci` não está disponível nesta versão/build do servidor
DEV (não retornada pela consulta).

Critério de decisão aplicado (definido pelo Platform Architect):

1. Se `utf8mb4_uca1400_ai_ci` estiver disponível → padrão oficial.
2. Caso contrário, usar `utf8mb4_unicode_520_ci`.
3. `utf8mb4_general_ci` é apenas fallback de compatibilidade.

Como `utf8mb4_uca1400_ai_ci` não está disponível e `utf8mb4_unicode_520_ci`
está disponível, a collation oficial de `pctec_ingressa` passa a ser
**`utf8mb4_unicode_520_ci`**. `utf8mb4_general_ci` permanece documentada
apenas como fallback de compatibilidade, não como padrão.

Esta verificação não criou nem alterou nenhum banco de dados; foi somente
uma consulta de metadados do servidor.

## Consequências (atualizado)

- Charset oficial: `utf8mb4`. Collation oficial:
  `utf8mb4_unicode_520_ci`.
- `docs/03-dominio/MODELO-RELACIONAL-PROPOSTO.md` foi atualizado para
  refletir a collation oficial, removendo a pendência de decisão associada.
- Caso o servidor de produção venha a rodar uma versão de MariaDB que
  ofereça `utf8mb4_uca1400_ai_ci`, uma nova verificação de capacidade deve
  ser executada antes de qualquer migration executável, e este ADR deve ser
  revisado se o resultado mudar a collation oficial.
- Nenhuma outra decisão desta entrega foi alterada por esta atualização.

## Status

Aprovado pelo Product Owner (motor MariaDB) e pelo Platform Architect
(collation `utf8mb4_unicode_520_ci`) — v0.2.0 Domain Foundation.
