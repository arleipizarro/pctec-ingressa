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
module.exports = {
  apps: [
    {
      name: "ingressa-backend",
      cwd: "/app/pctec-ingressa/backend",
      script: "dist/main.js",
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
