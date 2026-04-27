import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ["app/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "build", ".react-router"],
  },
});
