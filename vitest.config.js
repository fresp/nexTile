import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.js", "lib/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["lib/**/*.js"],
      exclude: [
        "lib/prefs/**", // Preferences UI, not testable without GTK4
        "lib/extension/cheatsheet.js", // UI-only (St/Clutter widgets)
        "lib/extension/indicator.js", // UI-only (Quick Settings panel)
        "lib/extension/extension-theme-manager.js", // UI-only (stylesheet management)
        "**/*.test.js",
        "**/mocks/**",
      ],
      all: true,
      // Regression ratchet (nextile-fhen.8): set a few points below the measured
      // baseline so a drop in coverage fails CI without an immediately-red build.
      // Baseline with vitest 5 / @vitest/coverage-v8 5: stmts 88.57%, branches
      // 83.00%, funcs 92.01%, lines 91.51%. The earlier floors (90/85/90/90) were
      // set against a vitest 2 baseline of 92.41%; coverage-v8 5 counts the same
      // code lower (the first commit measures 88.12% with it), so they were
      // recalibrated, not relaxed. Raise these as coverage improves; do NOT lower
      // them to make a red build pass.
      thresholds: {
        lines: 89,
        branches: 81,
        functions: 90,
        statements: 86,
      },
    },
  },
});
