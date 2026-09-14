import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  // Unit tests run by default; integration tests need a live MongoDB and run
  // with `npm run test:integration` (vitest --mode integration).
  const integration = mode === "integration";
  return {
    plugins: [tsconfigPaths(), react()],
    test: {
      environment: "node",
      include: integration ? ["src/**/*.integration.test.ts"] : ["src/**/*.test.{ts,tsx}"],
      exclude: integration ? [] : ["src/**/*.integration.test.ts"],
      ...(integration && { testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false }),
    },
  };
});
