// Configuração PM2 do ingressa-backend — v0.4.1 (Runtime Bootstrap).
//
// NÃO iniciado nesta fatia (nenhum `pm2 start/restart/save` foi
// executado). Preparado apenas para uso futuro.
//
// Nome do arquivo: `ecosystem.config.cjs` (não `.js`) — decisão
// deliberada, não um desvio arbitrário do pedido original. O
// `package.json` deste backend tem `"type": "module"`, então um arquivo
// `ecosystem.config.js` seria interpretado como ESM por padrão, e
// `module.exports` (usado pelo PM2 para carregar a config) falharia em
// tempo de carregamento. `.cjs` força CommonJS independentemente do
// `type` do package.json, que é o formato que o PM2 espera de forma
// confiável nesta versão. Se preferir manter exatamente o nome
// `ecosystem.config.js`, será necessário reescrever este arquivo em
// sintaxe ESM (`export default`) e validar compatibilidade com a versão
// de PM2 usada em produção antes de trocar — sinalizando aqui em vez de
// assumir silenciosamente.
// v0.4.2 — corrigido o campo `script` de `dist/server.js` para
// `dist/main.js` (defeito real observado em DEV: `dist/server.js` não é
// mais o entrypoint executável — é um módulo reutilizável/import-safe
// que nunca inicia nada sozinho ao ser carregado; quem de fato chama
// `startServer()` é `dist/main.js`. Ver `src/main.ts`/`src/server.ts`
// para a causa raiz completa).
// v0.10.x — `node_args` com DOIS `--env-file`.
//
// O processo já rodava com `--env-file=.env`, mas essa flag vinha da
// linha de comando de quem deu `pm2 start`, não deste arquivo: o
// ecosystem versionado não a declarava, e a diferença vivia só no
// `pm2 save` fora do repositório. Declará-la aqui faz a configuração de
// inicialização voltar a ser a que está sob revisão.
//
// O segundo arquivo é o da fonte Helpdesk, exigido pelo assistente de
// importação (v0.10.x). Sem ele, `loadHelpdeskSourceConfig()` falha e
// as rotas do assistente respondem 503 — fail-closed deliberado, nunca
// um default de host, usuário ou senha.
//
// **Somente CAMINHOS aparecem aqui.** A credencial continua morando
// exclusivamente em `/app/.config/pctec-ingressa/helpdesk-source.env`
// (dir 700, arquivo 600, fora do repositório), lida pelo Node no boot.
// Copiá-la para `backend/.env` criaria uma segunda cópia do segredo,
// com outra permissão e outro ciclo de rotação — exatamente o que a
// separação em env-file veio evitar.
//
// Node 22 aplica os `--env-file` na ordem dada e o último vence. Não há
// colisão de nome entre os dois (o prefixo `HELPDESK_DB_*` existe para
// isso), mas a ordem é a MESMA usada pelo CLI do importador, para que
// servidor e CLI nunca resolvam a mesma variável de formas diferentes.
const ENV_FILE_APLICACAO = ".env";
const ENV_FILE_FONTE_HELPDESK = "/app/.config/pctec-ingressa/helpdesk-source.env";

module.exports = {
  apps: [
    {
      name: "ingressa-backend",
      cwd: "/app/pctec-ingressa/backend",
      script: "dist/main.js",
      node_args: [`--env-file=${ENV_FILE_APLICACAO}`, `--env-file=${ENV_FILE_FONTE_HELPDESK}`],
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "development",
        HOST: "127.0.0.1",
        PORT: "3011"
      }
    }
  ]
};
