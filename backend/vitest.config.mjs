import { defineConfig } from "vitest/config";

// Vite normalises resolved module ids to forward slashes on every platform.
const SOURCE_DIRS =
  /[/](database|logging|middlewares|modules|properties|responses|services|startup|validators)[/]/;

const shared = {
  environment: "node",
  globals: false,
  restoreMocks: true,
  clearMocks: true,

  server: {
    deps: {
      // The app source is CommonJS. Left alone, Vitest transforms a file
      // reached through an ESM `import` but leaves an internal `require()` to
      // Node, loading modules on both paths twice - which makes Mongoose throw
      // OverwriteModelError and lets a faked module coexist with the real one.
      // Externalising the source makes both paths resolve to one instance.
      external: [SOURCE_DIRS],
    },
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: "unit",
          include: ["tests/unit/**/*.test.js"],
          // No globalSetup: this project stays a sub-second feedback loop.
          setupFiles: ["./tests/setup/env.js", "./tests/setup/fakes.js"],
        },
      },
      {
        test: {
          ...shared,
          name: "integration",
          include: ["tests/integration/**/*.test.js", "tests/api/**/*.test.js"],
          // env.js must run before anything pulls in properties/config.js.
          setupFiles: ["./tests/setup/env.js", "./tests/setup/fakes.js", "./tests/setup/mongo.js"],
          globalSetup: ["./tests/setup/global-setup.js"],
          // Safe in parallel: each worker gets its own database, see helpers/db.js.
          pool: "forks",
          testTimeout: 20_000,
          // Connecting and syncing indexes needs far more room than an assertion.
          hookTimeout: 120_000,
        },
      },
    ],

    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "modules/**/*.js",
        "middlewares/**/*.js",
        "services/**/*.js",
        "validators/**/*.js",
        "responses/**/*.js",
      ],
      exclude: ["**/node_modules/**", "services/cloudinary.service.js"],
    },
  },
});
