import { defineConfig } from "vitest/config";

/**
 * Configuração de testes de integração.
 *
 * Roda apenas *.integration.test.ts. Esses testes exigem uma conexão
 * MariaDB real e só executam de fato se a variável de ambiente
 * RUN_INTEGRATION_TESTS=true estiver presente — do contrário, cada teste
 * de integração se marca como "skipped" (ver
 * src/shared/types/integration-test-guard.ts).
 *
 * Uso: npm run test:integration
 * (requer RUN_INTEGRATION_TESTS=true e variáveis DB_* apontando para um
 * MariaDB de fato disponível — nunca configurado por padrão neste
 * repositório, e nunca aponta para o ambiente DEV automaticamente).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    environment: "node",
    passWithNoTests: true
  }
});
