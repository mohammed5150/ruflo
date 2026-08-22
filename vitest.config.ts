import { defineConfig, configDefaults } from 'vitest/config';

// Root-level vitest config. The root suite (npm test / scripts/ci-test-ratchet.mjs)
// discovers tests across the whole repo by default; this config only narrows
// discovery to tests that can actually run under the root harness.
export default defineConfig({
  test: {
    // Match v3/vitest.config.ts (and the hooks package's own config): several
    // suites cold-load ReasoningBank patterns / ONNX embeddings and legitimately
    // exceed vitest's 5s default when the root runner picks them up.
    testTimeout: 30000,
    hookTimeout: 30000,
    exclude: [
      ...configDefaults.exclude,
      // ruflo/src/ruvocal is a vendored SvelteKit app with its own npm
      // lockfile, its own vitest, and a vite config providing the svelte
      // plugin, SvelteKit aliases ($lib, $env) and the generated
      // .svelte-kit/tsconfig.json its tsconfig extends. Its tests only run
      // under that harness (cd ruflo/src/ruvocal && npx vitest); under root
      // vitest every one of them dies at transform time (TSCONFIG_ERROR)
      // before a single test executes.
      'ruflo/src/ruvocal/**',
      // node:test-based suites — vitest cannot collect them (they report
      // "no test suite found" and count as failed files). They are run and
      // gated by scripts/run-node-tests.mjs instead (wired into npm run
      // test:node and ci.yml). Keep this list in sync with SCAN_DIRS there.
      'tests/**',
      'v3/__tests__/appliance/**',
      'v3/@claude-flow/embeddings/__tests__/*.test.mjs',
      'plugins/**/*.test.mjs',
      'plugins/**/*.test.cjs',
      // These two are node:test files; scripts/__tests__/ci-test-ratchet.test.mjs
      // is vitest-based and deliberately NOT excluded.
      'scripts/__tests__/audit-supply-chain.test.mjs',
      'scripts/__tests__/stage-internal-runtime-bundles.test.mjs',
    ],
  },
});
