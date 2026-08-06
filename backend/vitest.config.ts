import { defineConfig } from "vitest/config";

/**
 * Configuração padrão de testes.
 *
 * Roda apenas testes unitários (*.test.ts). Testes de integração
 * (*.integration.test.ts) são excluídos daqui e só rodam via
 * `npm run test:integration`, que exige a variável de ambiente
 * RUN_INTEGRATION_TESTS=true e uma conexão MariaDB real configurada.
 *
 * Isso garante que `npm test` nunca dependa de banco externo.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts", "node_modules/**", "dist/**"],
    environment: "node",
    passWithNoTests: false
  }
});
