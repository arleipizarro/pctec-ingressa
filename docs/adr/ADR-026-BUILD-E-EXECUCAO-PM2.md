# ADR-026 — Estratégia de build e execução em produção: TypeScript compilado, PM2 sobre `dist/`

## Contexto

O backend do PCTEC Ingressa é escrito em TypeScript (ADR de stack aprovada
nas entregas anteriores; ver `SOFTWARE-ARCHITECTURE-BLUEPRINT.md` e o
prompt de implementação da v0.4.0). Até esta decisão, não havia registro
formal de como o backend seria executado em produção — especificamente,
se o processo de produção rodaria TypeScript diretamente (via um loader
como `ts-node`/`tsx`) ou o resultado compilado para JavaScript.

Rodar `.ts` diretamente em produção, mesmo com loaders modernos, introduz
custo de transpilação em tempo de execução, uma superfície de falha
adicional (o loader em si) e diverge do padrão operacional já usado no
restante do ecossistema PCTEC (Nginx → localhost → PM2 → Node), que
espera um processo Node.js executando JavaScript já resolvido.

## Decisão

1. O backend é escrito em TypeScript, mantendo `strict` habilitado (já
   configurado desde a v0.4.0 Slice 1).
2. Em produção, o PM2 **nunca** executa arquivos `.ts` diretamente — ele
   gerencia um processo Node.js apontando para o resultado compilado em
   `dist/` (ex.: `dist/server.js` ou entrypoint equivalente, a ser
   definido quando o primeiro entrypoint HTTP for implementado).
3. `npm run build` (já existente desde a v0.4.0 Slice 1) é uma etapa
   **obrigatória** antes de qualquer restart ou deploy — o PM2 nunca deve
   ser reiniciado apontando para uma `dist/` desatualizada em relação ao
   `src/` correspondente.
4. A operação continua no padrão já estabelecido para o ecossistema
   PCTEC: Nginx → localhost → PM2 → Node. Esta decisão não introduz nem
   altera esse padrão — apenas formaliza que a camada "Node" roda
   JavaScript compilado, não TypeScript interpretado.
5. Tipagem em TypeScript deve permanecer pragmática: `strict` é
   mandatório, mas abstrações de tipo excessivamente complexas ou
   "acadêmicas" (genéricos profundamente aninhados, condicionais de tipo
   elaborados, etc., sem ganho prático claro) devem ser evitadas em favor
   de tipos diretos e legíveis.

## Fora do escopo desta decisão (explicitamente adiado)

- Porta e quantidade de instâncias do processo Node — **Pendente de
  decisão**.
- Criação de `ecosystem.config.js` (arquivo de configuração do PM2) —
  **não criado nesta fatia**; fica para quando o backend tiver um
  entrypoint HTTP real a executar.
- Início efetivo de servidor, PM2 ou qualquer processo — **nada é
  iniciado como consequência desta decisão**; esta é uma decisão
  arquitetural registrada antecipadamente, não uma mudança operacional
  imediata.
- Definição do caminho exato do entrypoint de produção (`dist/server.js`
  é o exemplo dado, não uma confirmação final de nome de arquivo) — será
  definido quando a primeira rota HTTP for implementada (ver limites
  registrados em `backend/README.md`, v0.4.0 Slice 1: nenhuma rota HTTP
  existe ainda).

## Consequências

- Nenhum código funcional é alterado por esta decisão — é registro
  arquitetural puro, antecipando a fatia que introduzirá o primeiro
  entrypoint HTTP.
- Quando esse entrypoint for criado, o pipeline de deploy (fora do escopo
  desta entrega) deverá garantir `npm run build` antes de qualquer
  `pm2 restart`/`pm2 reload`, nunca configurando o PM2 para rodar um
  arquivo `.ts` via loader.
- `ecosystem.config.js` e a definição de porta/instâncias ficam como
  pendências explícitas para a fatia que efetivamente introduzir o
  entrypoint de produção.

## Status

Aprovado pelo Product Owner e pelo Platform Architect — decisão
antecipada, sem implementação nesta fatia.
