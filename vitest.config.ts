import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    // Vitest discovers anything matching `*.test.*` / `*.spec.*` by
    // default, which would sweep in e2e/*.spec.ts (Playwright's tests).
    // Restrict to the unit test directories.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
