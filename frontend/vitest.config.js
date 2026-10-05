import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: false,
      restoreMocks: true,
      clearMocks: true,
      unstubEnvs: true,
      unstubGlobals: true,
      include: ["tests/**/*.test.{js,jsx}"],
      setupFiles: [
        "./tests/setup/env.js",
        "./tests/setup/dom.js",
        "./tests/setup/msw.js",
      ],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
        include: ["src/**/*.{js,jsx}"],
        exclude: ["src/main.jsx"],
      },
    },
  })
);
