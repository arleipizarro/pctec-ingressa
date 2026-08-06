# Constituição da Plataforma PCTEC

Versão associada: v0.2.0 — Domain Foundation
Status: Proposto para revisão do Product Owner e do Platform Architect

## 1. Propósito deste documento

Este documento estabelece os princípios permanentes que regem o PCTEC
Ingressa e sua relação com os demais produtos do ecossistema PCTEC. Ele não
descreve implementação. Ele descreve regras que qualquer implementação
futura deve respeitar.

Alterar um princípio desta constituição exige uma nova decisão arquitetural
registrada em ADR, com justificativa explícita. Nenhuma mudança de
comportamento no código pode contrariar este documento silenciosamente.

## 2. Missão da plataforma

O PCTEC Ingressa é a plataforma corporativa de identidade, acesso,
organizações e autenticação do ecossistema PCTEC. Ele existe para eliminar a
duplicidade e a divergência de cadastros de pessoas, organizações e acessos
entre os produtos PCTEC, oferecendo um ponto único, auditável e seguro de
verdade sobre "quem é quem", "quem pertence a qual organização" e "quem pode
acessar qual aplicação".

O Ingressa não substitui a lógica de negócio de nenhum produto consumidor.
Ele resolve identidade, organização e acesso global. Cada produto continua
dono das suas próprias regras internas.

## 3. Fonte única da verdade

O Ingressa é a fonte única da verdade para os seguintes conceitos:

- Identidades de pessoas.
- Perfis associados a uma identidade (`EMPLOYEE`, `CUSTOMER`, `PARTNER`,
  `SUPPLIER` e, futuramente, `SERVICE_ACCOUNT`).
- Grupos empresariais e empresas (Cadastro Mestre de Organizações).
- Vínculos organizacionais (Memberships).
- Autenticação e credenciais.
- Sessões e tokens de sessão.
- Acesso global de uma identidade/perfil a uma aplicação do ecossistema.

Nenhum outro produto PCTEC deve manter uma cópia autoritativa desses dados.
Cópias derivadas (para performance ou disponibilidade local) são permitidas
apenas como espelhamento explicitamente reconciliado com o Ingressa, nunca
como fonte concorrente de verdade.

O que **não** é fonte única do Ingressa: permissões internas de negócio de
cada produto (por exemplo, quem pode fechar um chamado, aprovar um contrato
ou editar um item de patrimônio). Essas regras pertencem e permanecem nos
produtos consumidores.

## 4. Banco privado por produto

Cada produto do ecossistema PCTEC, incluindo o Ingressa, possui seu próprio
banco de dados. Nenhum produto acessa diretamente o banco de outro produto,
seja para leitura ou escrita.

Toda troca de dados entre o Ingressa e um produto consumidor ocorre por:

- API versionada (mecanismo primário e autoritativo); ou
- Eventos de domínio (mecanismo de propagação assíncrona, futuro); ou
- Sincronização periódica de reconciliação (mecanismo de correção de
  divergências, futuro).

Não existe, em nenhuma circunstância prevista, acesso direto de um produto
consumidor à base `pctec_ingressa`, nem do Ingressa às bases dos produtos
consumidores.

## 5. API First

Toda capacidade do Ingressa é exposta primeiro como contrato de API
versionado. A API é a interface oficial e estável entre o Ingressa e o
restante do ecossistema. Interfaces administrativas (painel, área "Minha
Conta") são consumidoras da mesma API, não atalhos privilegiados.

Contratos de API seguem versionamento explícito (`/api/v1/...`) e mudanças
que quebrem compatibilidade exigem uma nova versão, nunca alteração
silenciosa de uma versão já publicada.

## 6. Autenticação centralizada

O Ingressa é o único responsável por autenticar identidades no ecossistema
PCTEC. Login local, ativação de conta, recuperação de credencial e (no
futuro) SSO/OIDC são capacidades exclusivas do Ingressa.

Produtos consumidores não implementam seus próprios mecanismos de login
independentes para os mesmos usuários que o Ingressa já governa. A adoção de
cada consumidor é gradual e ocorre conforme a Estratégia de Migração de
Impacto Zero (seção 10).

## 7. Autorização em duas camadas

A autorização no ecossistema PCTEC é dividida em duas camadas distintas e
não sobrepostas:

1. **Autorização global (Ingressa):** decide se uma identidade/perfil possui
   acesso à aplicação como um todo — o equivalente a estar ou não na "porta
   de entrada" daquele produto. Não decide o que a pessoa pode fazer dentro
   do produto.
2. **Autorização local (produto consumidor):** decide o que a identidade
   pode fazer dentro daquele produto — papéis, permissões finas, regras de
   negócio. Essa camada é de responsabilidade exclusiva de cada produto.

O Ingressa nunca modela permissões operacionais de domínios consumidores
(chamados, patrimônio, contratos, faturamento, logística, SLA ou
equivalentes). Ver ADR-007 (atualizado nesta entrega).

## 8. Auditoria por padrão

Toda ação sensível dentro do domínio do Ingressa — criação e alteração de
identidade, concessão e revogação de acesso a aplicação, criação e revogação
de sessão, consumo de magic link, alteração de credencial — gera um evento
de auditoria (`AuditEvent`). Auditoria não é um recurso opcional adicionado
depois; é uma propriedade estrutural do domínio desde a fundação.

Auditoria é auditoria de segurança e administração do próprio domínio do
Ingressa. Ela não substitui, nem tenta substituir, os logs de auditoria de
negócio interno de cada produto consumidor.

## 9. Identificadores públicos imutáveis

Toda entidade exposta pela API do Ingressa possui um identificador público
do tipo UUID, gerado no momento da criação e imutável durante todo o ciclo
de vida da entidade.

IDs internos numéricos (por exemplo, chaves primárias autoincrementais no
banco) podem existir por razões de performance de armazenamento, mas nunca
são expostos em nenhuma resposta de API, log voltado a consumidores, ou
contrato externo.

## 10. Regras de ownership

| Conceito | Dono |
|---|---|
| Identidades, perfis, credenciais, sessões | PCTEC Ingressa |
| Grupos empresariais e empresas (Cadastro Mestre) | PCTEC Ingressa |
| Vínculos organizacionais (Memberships) | PCTEC Ingressa |
| Acesso global às aplicações | PCTEC Ingressa |
| Auditoria do domínio de identidade/acesso | PCTEC Ingressa |
| Permissões internas de negócio | Cada produto consumidor |
| Regras operacionais (chamados, patrimônio, contratos, SLA, faturamento, logística) | Cada produto consumidor |

Um produto consumidor pode manter uma cópia local mínima e reconciliada de
identificadores (por exemplo, o UUID de identidade) para relacionar seus
próprios dados internos, mas não decide, nem armazena como autoritativo,
nenhum atributo pertencente ao Ingressa.

## 11. Estratégia de impacto zero

Nenhuma adoção do Ingressa por um produto consumidor pode causar
indisponibilidade, perda de dados ou quebra de acesso para usuários já
existentes. Toda migração segue construção isolada, espelhamento,
reconciliação, ativação por feature flag, piloto controlado, validação dupla
e possibilidade de rollback imediato para o provedor legado até que o
corte seja formalmente aprovado. Detalhamento em
`docs/06-governanca/ESTRATEGIA-DE-MIGRACAO-IMPACTO-ZERO.md`.

## 12. Arquitetura precede implementação

Nenhuma capacidade do Ingressa é implementada sem que a decisão
arquitetural correspondente já exista, documentada e aprovada (em ADR,
modelo de domínio ou contrato de API). Código não define arquitetura;
código implementa arquitetura previamente decidida. Divergências percebidas
durante a implementação retornam para decisão explícita, não são resolvidas
silenciosamente no código.

## 13. Questões pendentes de decisão

- Definir algoritmo de hash de senha (fora do escopo desta entrega).
- Definir biblioteca/formato de token de sessão e JWT, se aplicável (fora do
  escopo desta entrega).
- Confirmar se `SERVICE_ACCOUNT` entra no MVP ou permanece apenas como
  extensão futura do enum `Profile`.
