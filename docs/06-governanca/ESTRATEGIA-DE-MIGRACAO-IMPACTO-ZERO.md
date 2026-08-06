# Estratégia de Migração de Impacto Zero

Versão associada: v0.2.0 — Domain Foundation
Status: Proposto para revisão do Product Owner e do Platform Architect

## 1. Princípio

Nenhuma adoção do PCTEC Ingressa por um produto consumidor pode causar
indisponibilidade, perda de dados, ou quebra de acesso para usuários já
existentes desse produto. A migração é sempre gradual, reversível e
validada antes de qualquer corte definitivo.

## 2. Etapas

### 2.1 Construção isolada

O Ingressa é construído e evolui de forma isolada, sem qualquer dependência
de tempo real dos produtos consumidores durante seu desenvolvimento.
Nenhum produto consumidor é modificado nesta etapa.

### 2.2 Espelhamento

Dados relevantes já existentes em um produto consumidor (por exemplo,
usuários do PCTEC Portal) são espelhados para o Ingressa por meio de
processo de carga controlado, sem que o produto consumidor deixe de
operar com seu provedor de identidade legado.

O espelhamento é unidirecional (legado → Ingressa) nesta etapa. O Ingressa
ainda não é fonte de verdade operacional para o consumidor.

### 2.3 Reconciliação

Após o espelhamento inicial, um processo de reconciliação periódica
compara o estado do provedor legado com o estado espelhado no Ingressa,
identificando e reportando divergências (registros ausentes, campos
divergentes, duplicidades de e-mail/CPF). Divergências são tratadas antes
de qualquer avanço para a próxima etapa.

### 2.4 Feature flag

A integração efetiva entre um produto consumidor e o Ingressa é controlada
por feature flag, permitindo habilitar o novo fluxo de autenticação/acesso
para subconjuntos de usuários sem afetar os demais, e permitindo desativar
instantaneamente em caso de problema.

### 2.5 Piloto

Um grupo restrito e conhecido de usuários é selecionado para operar com o
Ingressa como provedor ativo, enquanto o restante da base continua no
provedor legado. O piloto é observado quanto a erros de autenticação,
divergência de acesso e feedback dos usuários selecionados.

### 2.6 Dual validation

Durante o piloto (e potencialmente além dele), autenticações podem ser
validadas contra ambos os provedores (legado e Ingressa) para o mesmo
usuário, comparando resultados antes de decidir qual resposta é usada, como
mecanismo de confiança adicional antes do corte. O mecanismo técnico exato
de dual validation é Pendente de decisão de implementação.

### 2.7 Corte

Somente após o piloto validado e a reconciliação estável, o produto
consumidor passa a tratar o Ingressa como provedor primário para a
totalidade dos seus usuários. O corte é uma decisão explícita do Product
Owner, não uma consequência automática de prazo.

### 2.8 Rollback

Em qualquer etapa até a consolidação pós-corte, deve existir um caminho de
retorno imediato ao provedor legado, sem perda de acesso para os usuários
já migrados. Nenhuma etapa avança sem que o rollback da etapa anterior
tenha sido validado como funcional.

### 2.9 Desativação gradual do legado

Somente após um período de estabilização pós-corte, definido caso a caso
com o Product Owner, o provedor legado é desativado para aquele produto
consumidor especificamente. A desativação do legado é sempre por produto
consumidor, nunca uma decisão global simultânea para todo o ecossistema.

## 3. Critérios de go/no-go

Critérios mínimos para avançar de uma etapa para a seguinte (lista inicial,
sujeita a expansão por produto consumidor específico):

| Critério | Etapa aplicável |
|---|---|
| Zero divergências não tratadas na reconciliação | Espelhamento → Feature flag |
| Rollback testado e documentado | Feature flag → Piloto |
| Piloto sem incidente de autenticação por período mínimo (prazo Pendente de decisão) | Piloto → Corte |
| Aprovação explícita do Product Owner | Piloto → Corte |
| Nenhum chamado de suporte relacionado a acesso aberto e não resolvido | Corte → Desativação do legado |

## 4. Escopo desta entrega

Esta entrega documenta a estratégia. Nenhuma etapa é executada nesta fase:
não há espelhamento, feature flag, piloto ou corte implementados. A
aplicação prática desta estratégia ocorre em versões futuras, começando
pelo primeiro consumidor (PCTEC Portal), conforme `docs/07-roadmap/ROADMAP.md`.

## 5. Questões pendentes de decisão

- Prazo mínimo de observação do piloto antes do corte.
- Mecanismo técnico de dual validation.
- Ferramenta/processo de reconciliação (execução manual versus rotina
  automatizada).
- Critério de seleção do grupo piloto para cada produto consumidor.
