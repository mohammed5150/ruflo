/**
 * V3 Claude-Flow Vitest Configuration
 *
 * London School TDD Configuration
 * - Mock-first testing approach
 * - Behavior verification over state testing
 * - Clear isolation between units
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

const INCLUDE = [
  '__tests__/**/*.test.ts',
  '__tests__/**/*.spec.ts',
  '@claude-flow/**/__tests__/**/*.test.ts',
  '@claude-flow/**/__tests__/**/*.spec.ts',
  'mcp/__tests__/**/*.test.ts',
  'mcp/__tests__/**/*.spec.ts',
];

// Globs must match at any depth: the bare 'node_modules' only matched
// the top level, so every package's workspace symlinks
// (@claude-flow/*/node_modules/@claude-flow/*) re-collected the same
// test files several times over.
const EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  // node:test suites — vitest cannot collect them ("No test suite found").
  // scripts/run-node-tests.mjs runs and gates them, as for the root config.
  '__tests__/appliance/**',
];

// The CLI package's suites run in forked subprocesses rather than worker
// threads:
// - 19 of them call process.chdir(), which throws inside worker threads;
// - several load native bindings (ruvector, onnxruntime) whose
//   worker-thread teardown segfaults and kills the whole run, not just the
//   file (seen after memory-ruvector-deep and mcp-tools-deep).
// Vitest 4 removed `poolMatchGlobs`, so these are routed by project below.
const FORKED = [
  '@claude-flow/cli/__tests__/**/*.test.ts',
  '@claude-flow/cli/__tests__/**/*.spec.ts',
];

// Path aliases for clean imports
const resolveConfig = {
  alias: {
    '@': path.resolve(__dirname, './src'),
    '@tests': path.resolve(__dirname, './__tests__'),
    '@fixtures': path.resolve(__dirname, './__tests__/fixtures'),
    '@helpers': path.resolve(__dirname, './__tests__/helpers'),
    '@mocks': path.resolve(__dirname, './__tests__/mocks'),
    '@security': path.resolve(__dirname, './modules/security'),
    '@memory': path.resolve(__dirname, './modules/memory'),
    '@swarm': path.resolve(__dirname, './modules/swarm'),
    '@core': path.resolve(__dirname, './modules/core'),
  },
};

// Options shared by both projects. Projects do not inherit the root
// `test` block, so everything per-test lives here.
const sharedTest = {
  // Test environment
  environment: 'node' as const,

  // Global test setup
  setupFiles: ['./__tests__/setup.ts'],

  // Mock configuration for London School approach
  mockReset: true,
  clearMocks: true,
  restoreMocks: true,

  // Timeout for async operations.
  // Bumped from 10s → 30s because CI runners cold-load HuggingFace models
  // and ONNX runtimes that take 5-20s on first call, causing timeout
  // failures in guidance-provider and reasoningbank tests. Local runs
  // with cached models still finish in <1s; the headroom only matters
  // on cold environments.
  testTimeout: 30000,
  hookTimeout: 30000,

  isolate: true,

  // Globals for easier testing
  globals: true,

  // Type checking disabled - it.each syntax not supported in type testing
  // Use separate `npm run typecheck` for type validation
  typecheck: {
    enabled: false,
  },
};

export default defineConfig({
  resolve: resolveConfig,
  test: {
    // Parallel execution.
    // 'threads' stays the default. Briefly tried 'forks' for everything
    // because of exit-time segfaults from native bindings
    // (onnxruntime-node / ruvector / agentic-flow) — but forks expose
    // module-load unhandled rejections more aggressively, causing 12 test
    // files (transformers transitive-importers) to fail with 'No test
    // suite found'. Only the FORKED suites above run in forks. CI still
    // tolerates exit code 139 when results were reported (see test job).
    projects: [
      {
        resolve: resolveConfig,
        test: {
          ...sharedTest,
          name: 'threads',
          pool: 'threads',
          include: INCLUDE,
          exclude: [...EXCLUDE, ...FORKED],
        },
      },
      {
        resolve: resolveConfig,
        test: {
          ...sharedTest,
          name: 'forks',
          pool: 'forks',
          include: FORKED,
          exclude: EXCLUDE,
        },
      },
    ],

    // Coverage configuration - London School targets
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './__tests__/coverage',

      // Coverage thresholds disabled for alpha (London School TDD uses mocks)
      // TODO: Re-enable for stable release with proper coverage instrumentation
      // thresholds: {
      //   lines: 60,
      //   functions: 60,
      //   branches: 50,
      //   statements: 60,
      // },

      // Files to include in coverage
      include: [
        'src/**/*.ts',
        'modules/**/*.ts',
      ],

      // Files to exclude from coverage
      exclude: [
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
        '**/__tests__/**',
        '**/fixtures/**',
        '**/mocks/**',
      ],
    },

    // Reporter configuration
    reporters: ['default'],
  },
});
