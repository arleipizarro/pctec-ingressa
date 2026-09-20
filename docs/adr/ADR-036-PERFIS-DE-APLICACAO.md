# ADR-036 — Perfis de aplicação: a camada 2 de ADR-007 ganha registro oficial no Ingressa

## Contexto

ADR-007 estabelece a autorização em duas camadas:

| Camada | Pergunta | Onde |
|---|---|---|
| 1 | esta Identity pode ENTRAR na aplicação? | `application_accesses`, aqui |
| 2 | o que ela pode FAZER dentro dela? | no produto consumidor |

O PCTEC Meu RH implementou a camada 2 na Etapa 1 exatamente assim: uma
tabela `meurh_role_assignments` no banco dele, concedida por um CLI
próprio. O desenho respeitava ADR-007 e funcionou — mas produziu um
efeito que só aparece com o produto em uso:

**duas listas de concessão vivas ao mesmo tempo.** O Ingressa dizia quem
podia entrar; o Meu RH dizia, numa segunda tabela, quem podia
administrar. Conceder o acesso administrativo exigia dois atos, em dois
sistemas, e nada garantia que o segundo acontecesse. Revogar o acesso de
alguém no Ingressa deixava o papel local vivo, apontando para uma pessoa
que não entra mais. A administração de acesso não tinha um lugar único
para se olhar.

`AccessProfile` não resolve isso: ele é, por ADR-028 e ADR-032, um enum
FECHADO e GLOBAL (`ADMIN`/`USER`) sobre a aplicação inteira. Empurrar
`MEURH_RH_RESPONSAVEL` para dentro dele transformaria um enum de
plataforma num depósito de regras de negócio de cada produto
consumidor — precisamente o que ADR-007 separa.

## Decisão

1. O Ingressa passa a guardar, de forma **genérica**, os perfis que cada
   aplicação declara e as concessões deles a identidades. Duas tabelas
   novas:

   - `application_roles` — catálogo por aplicação: `code`, `name`,
     `description`, `permissions` (JSON) e `sort_order`;
   - `application_role_assignments` — a concessão, referenciando
     `(identity_public_id, application_public_id, role_code)`.

2. **`access_profile` NÃO muda.** A camada 1 continua sendo
   `ADMIN`/`USER` sobre `application_accesses`, com a mesma semântica de
   ADR-028 e ADR-032. Nenhum valor novo entra naquele enum, e nenhuma
   aplicação existente é afetada: uma aplicação sem linhas em
   `application_roles` simplesmente não tem perfis — o comportamento de
   hoje.

3. **A camada 1 é pré-requisito da camada 2.** Conceder perfil a quem
   não tem `ApplicationAccess` GRANTED na aplicação é recusado
   (`APPLICATION_ROLE_IDENTITY_NOT_ELIGIBLE`). Perfil sem acesso seria
   uma autorização que não leva a lugar nenhum, guardada como se
   levasse. O consumidor recebe `roles: []` quando o acesso é nulo,
   mesmo que houvesse concessão.

4. **A concessão referencia (identity, application), e não a linha de
   `application_accesses`.** Trocar o `access_profile` de alguém é, por
   ADR-028 e pela unique de `0017`, revogar + conceder: uma linha nova.
   Se os perfis pendurassem na linha do acesso, promover alguém de
   `USER` para `ADMIN` apagaria em silêncio todos os perfis de produto
   que ela tinha.

5. **O CATÁLOGO fica em tabela; o ENFORCEMENT, não.** A concessão
   precisa ser administrável e auditável, e é isso que vive aqui. O
   SIGNIFICADO de um perfil — quais permissões ele libera, quais rotas
   ele abre — continua em código no produto consumidor, revisado em pull
   request. A coluna `permissions` é a cópia DECLARATIVA desse
   significado, existente para que a UI administrativa possa exibir "o
   que este perfil inclui" sem consultar o produto: ela **descreve,
   nunca decide**. Divergência entre as duas listas muda o que a tela
   mostra, nunca o que a API do consumidor permite.

6. **Sem exclusão física** (ADR-020, mesmo princípio de
   `application_accesses`): revogar carimba `revoked_at` e mantém a
   linha. "Quem concedeu, quando, quem revogou e quando" é exatamente o
   que a administração precisa mostrar, e uma linha apagada não responde
   nada disso. Dois eventos novos no catálogo:
   `application-role.granted` e `application-role.revoked` — irmãos de
   `application-access.granted/revoked`, e separados deles porque
   conceder acesso ao produto e conceder um perfil dentro dele são
   decisões diferentes, tomadas por gente diferente em momentos
   diferentes.

7. **Dois caminhos de escrita, um serviço só.** A administração do
   Ingressa (`/api/v1/admin/...`, cadeia sessão + `ADMIN` em
   `PCTEC_INGRESSA`) e o namespace service-to-service do produto
   (`/api/v1/service/meu-rh/...`, credencial própria) escrevem pela
   MESMA classe de serviço. Nunca duas implementações da mesma
   concessão.

   A política de QUEM pode conceder o quê dentro do produto é do
   produto: é o Meu RH que decide que "responsável pelo RH não concede
   super admin" e que "ninguém altera a própria permissão". A fronteira
   daqui confere o que é dela — o perfil existe no catálogo, a pessoa
   tem acesso à aplicação — e recusa o resto.

8. Migrations: `0027` (catálogo), `0028` (concessões) e `0029` (seed dos
   quatro perfis de `PCTEC_MEU_RH`). O seed **não concede nada a
   ninguém**, pelo mesmo princípio de `0026`: registrar o perfil não é
   conceder o perfil.

## Consequências

- Existe um lugar único para responder "quem administra o Meu RH?", e
  ele é o mesmo que responde "quem pode entrar no Meu RH?".
- Um produto consumidor novo que precise de perfis não exige mudança
  neste desenho: declara o catálogo dele numa migration de seed e passa
  a consumir `GET /identities/:id/access-profile`, que devolve as duas
  camadas.
- O produto consumidor continua dono das próprias regras: o Ingressa não
  sabe o que `meurh.responses.view` significa, e não precisa saber.
- O Meu RH precisou de uma reconciliação única para levar as concessões
  da Etapa 1 para cá. As linhas antigas lá ficaram marcadas `MIGRATED` —
  nem `ACTIVE`, nem `REVOKED`: a concessão não foi retirada de ninguém,
  só deixou de ser guardada naquele banco.
- A mudança vale no próximo login ou renovação de sessão de quem foi
  afetado. O consumidor pode encurtar essa janela invalidando o próprio
  cache quando ele mesmo concede — o Meu RH faz isso.

## Alternativas descartadas

- **Estender `AccessProfile`.** Transformaria um enum de plataforma no
  depósito das regras de negócio de todo produto consumidor, contra
  ADR-007 e ADR-028.
- **Manter a camada 2 no consumidor.** É o desenho da Etapa 1, e foi
  o que produziu as duas listas. Funciona enquanto um único produto tem
  um único administrador; não sobrevive à primeira revogação feita só de
  um lado.
- **Mover também o mapa perfil → permissões para cá.** Tornaria o
  controle de acesso editável em produção por `UPDATE`, sem revisão — o
  pior lugar possível para isso — e obrigaria o Ingressa a conhecer o
  vocabulário de negócio de cada produto.
