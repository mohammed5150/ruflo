/**
 * Code Intelligence Plugin - MCP Tools Tests
 *
 * Tests for the MCP tool handlers against the current contract:
 * - Tools are `MCPTool` objects with zod `inputSchema`, `category`, `version`
 * - Handlers take `(input, ToolContext)` where the context carries real
 *   GNN/MinCut bridges plus a security config (`createToolContext`)
 * - Results are `{ content: [{ type: 'text', text }], data? }`; errors are
 *   reported in-band as `{ success: false, error, durationMs }` JSON
 * - Handler lookup goes through the exported `toolHandlers` map
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  semanticSearchTool,
  architectureAnalyzeTool,
  refactorImpactTool,
  splitSuggestTool,
  learnPatternsTool,
  codeIntelligenceTools,
  toolHandlers,
  createToolContext,
  type ToolContext,
} from '../src/mcp-tools.js';

const TOOL_NAMES = [
  'code/semantic-search',
  'code/architecture-analyze',
  'code/refactor-impact',
  'code/split-suggest',
  'code/learn-patterns',
];

// Fixture workspace with real files so handlers run end-to-end against the
// actual bridges (no mocks — the bridges have a pure-JS fallback path).
let fixtureDir: string;
let context: ToolContext;

/** Parse the JSON payload every tool writes into content[0].text */
function payload(result: { content: Array<{ type: 'text'; text: string }> }): any {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  return JSON.parse(result.content[0].text);
}

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-mcp-'));

  fs.writeFileSync(
    path.join(fixtureDir, 'auth.ts'),
    [
      "import { createSession } from './session.js';",
      '',
      'export async function login(username: string, password: string) {',
      '  // authentication login handler validates user credentials',
      '  return createSession(username);',
      '}',
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    path.join(fixtureDir, 'session.ts'),
    [
      'export function createSession(user: string) {',
      '  return { user, id: Math.random().toString(36) };',
      '}',
      '',
    ].join('\n'),
  );

  // Circular pair for circular-dependency detection
  fs.writeFileSync(
    path.join(fixtureDir, 'util-a.ts'),
    "import { b } from './util-b.js';\nexport const a = () => b;\n",
  );
  fs.writeFileSync(
    path.join(fixtureDir, 'util-b.ts'),
    "import { a } from './util-a.js';\nexport const b = () => a;\n",
  );

  // File with fake secrets, for end-to-end secret masking through the tool
  fs.writeFileSync(
    path.join(fixtureDir, 'config.ts'),
    [
      '// apiKey configuration constants for the service',
      'export const apiKey = "sk_live_abc123xyz";',
      'export const settings = { "api_key": "sk_live_abc123xyz" };',
      '',
    ].join('\n'),
  );

  // Test file, for the excludeTests scope option
  fs.writeFileSync(
    path.join(fixtureDir, 'auth.test.ts'),
    '// authentication login function test spec\nexport const t = 1;\n',
  );

  context = createToolContext();
});

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('Code Intelligence MCP Tools', () => {
  describe('Tool Registry', () => {
    it('should export all 5 tools', () => {
      expect(codeIntelligenceTools).toHaveLength(5);
    });

    it('should have correct tool names', () => {
      const toolNames = codeIntelligenceTools.map(t => t.name);
      for (const name of TOOL_NAMES) {
        expect(toolNames).toContain(name);
      }
    });

    it('should have category code-intelligence', () => {
      for (const tool of codeIntelligenceTools) {
        expect(tool.category).toBe('code-intelligence');
      }
    });

    it('should carry a consistent semver version on every tool', () => {
      for (const tool of codeIntelligenceTools) {
        expect(tool.version).toBe('3.0.0-alpha.1');
      }
    });

    it('should expose a handler for every tool name', () => {
      expect(toolHandlers.size).toBe(5);
      for (const name of TOOL_NAMES) {
        expect(toolHandlers.get(name)).toBeTypeOf('function');
      }
    });

    it('should return undefined for unknown tool', () => {
      expect(toolHandlers.get('code/unknown')).toBeUndefined();
    });
  });

  describe('code/semantic-search', () => {
    it('should have correct tool definition', () => {
      expect(semanticSearchTool.name).toBe('code/semantic-search');
      // zod schema: query is required, defaults are applied
      expect(semanticSearchTool.inputSchema.safeParse({}).success).toBe(false);
      const parsed = semanticSearchTool.inputSchema.safeParse({ query: 'x' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.searchType).toBe('semantic');
        expect(parsed.data.topK).toBe(10);
      }
    });

    it('should handle valid input', async () => {
      const input = {
        query: 'authentication login function',
        scope: { paths: [fixtureDir] },
        topK: 10,
      };

      const result = await semanticSearchTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results.length).toBeGreaterThan(0);
      expect(data.results.some((r: any) => r.filePath.endsWith('auth.ts'))).toBe(true);
      expect(typeof data.durationMs).toBe('number');
    });

    it('should handle language filter', async () => {
      const input = {
        query: 'authentication login function',
        scope: { paths: [fixtureDir], languages: ['typescript'] },
      };

      const result = await semanticSearchTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      for (const r of data.results) {
        expect(r.language).toBe('typescript');
      }
    });

    it('should exclude test files when excludeTests is set', async () => {
      const input = {
        query: 'authentication login function',
        scope: { paths: [fixtureDir], excludeTests: true },
      };

      const result = await semanticSearchTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      expect(data.results.length).toBeGreaterThan(0);
      expect(data.results.some((r: any) => /\.test\.ts$/.test(r.filePath))).toBe(false);
    });

    it('should reject missing query', async () => {
      const result = await semanticSearchTool.handler({ topK: 10 } as any, context);
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
    });

    it('should reject query exceeding max length', async () => {
      const result = await semanticSearchTool.handler(
        { query: 'a'.repeat(5001) } as any,
        context,
      );
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
    });

    it('should reject topK outside valid range', async () => {
      for (const topK of [0, 1001]) {
        const result = await semanticSearchTool.handler(
          { query: 'test', topK } as any,
          context,
        );
        const data = payload(result);
        expect(data.success).toBe(false);
      }
    });

    it('should reject path traversal in scope paths', async () => {
      const result = await semanticSearchTool.handler(
        { query: 'test', scope: { paths: ['../outside'] } } as any,
        context,
      );
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(data.error).toMatch(/traversal/i);
    });
  });

  describe('code/architecture-analyze', () => {
    it('should have correct tool definition', () => {
      expect(architectureAnalyzeTool.name).toBe('code/architecture-analyze');
      const parsed = architectureAnalyzeTool.inputSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.rootPath).toBe('.'); // default
      }
    });

    it('should handle valid input', async () => {
      const input = {
        rootPath: fixtureDir,
        analysis: ['dependency_graph', 'circular_deps', 'component_coupling'],
      };

      const result = await architectureAnalyzeTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      expect(data.rootPath).toBe(fixtureDir);
      expect(data.dependencyGraph).toBeDefined();
      expect(data.dependencyGraph.nodes.length).toBeGreaterThanOrEqual(5);
      expect(Array.isArray(data.circularDeps)).toBe(true);
      expect(Array.isArray(data.couplingMetrics)).toBe(true);
      expect(data.summary.totalFiles).toBe(data.dependencyGraph.nodes.length);
      expect(typeof data.durationMs).toBe('number');
    });

    it('should detect the util-a/util-b circular dependency', async () => {
      const input = { rootPath: fixtureDir, analysis: ['circular_deps'] };

      const result = await architectureAnalyzeTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      expect(data.circularDeps.length).toBeGreaterThanOrEqual(1);
      const cycleFiles = data.circularDeps.flatMap((c: any) => c.cycle).join(' ');
      expect(cycleFiles).toContain('util-');
    });

    it('should only include requested analyses', async () => {
      const input = { rootPath: fixtureDir, analysis: ['component_coupling'] };

      const result = await architectureAnalyzeTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      expect(Array.isArray(data.couplingMetrics)).toBe(true);
      expect(data.dependencyGraph).toBeUndefined();
      expect(data.circularDeps).toBeUndefined();
    });

    it('should reject path traversal in rootPath', async () => {
      const result = await architectureAnalyzeTool.handler(
        { rootPath: '../outside' } as any,
        context,
      );
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(data.error).toMatch(/traversal/i);
    });

    it('should reject rootPath exceeding max length', async () => {
      const result = await architectureAnalyzeTool.handler(
        { rootPath: 'a'.repeat(501) } as any,
        context,
      );
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
    });
  });

  describe('code/refactor-impact', () => {
    it('should have correct tool definition', () => {
      expect(refactorImpactTool.name).toBe('code/refactor-impact');
      // changes is required and must be non-empty
      expect(refactorImpactTool.inputSchema.safeParse({}).success).toBe(false);
      expect(refactorImpactTool.inputSchema.safeParse({ changes: [] }).success).toBe(false);
      const parsed = refactorImpactTool.inputSchema.safeParse({
        changes: [{ file: 'src/x.ts', type: 'rename' }],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.depth).toBe(3); // default
        expect(parsed.data.includeTests).toBe(true); // default
      }
    });

    it('should handle valid input', async () => {
      const input = {
        changes: [
          {
            file: path.join(fixtureDir, 'session.ts'),
            type: 'rename',
            details: { oldName: 'createSession', newName: 'openSession' },
          },
        ],
      };

      const result = await refactorImpactTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      expect(Array.isArray(data.impactedFiles)).toBe(true);
      expect(data.summary).toBeDefined();
      expect(['low', 'medium', 'high']).toContain(data.summary.totalRisk);
      expect(Array.isArray(data.suggestedOrder)).toBe(true);
      expect(Array.isArray(data.breakingChanges)).toBe(true);
      expect(typeof data.durationMs).toBe('number');
    });

    it('should handle all change types', async () => {
      const types = ['rename', 'move', 'delete', 'extract', 'inline'] as const;

      for (const type of types) {
        const input = {
          changes: [{ file: path.join(fixtureDir, 'auth.ts'), type }],
        };
        const result = await refactorImpactTool.handler(input as any, context);
        const data = payload(result);
        expect(data.success).toBe(true);
      }
    });

    it('should reject missing changes', async () => {
      const result = await refactorImpactTool.handler({} as any, context);
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
    });

    it('should reject invalid change type', async () => {
      const input = {
        changes: [{ file: path.join(fixtureDir, 'auth.ts'), type: 'invalid_change' }],
      };

      const result = await refactorImpactTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
    });

    it('should reject path traversal in change files', async () => {
      const input = {
        changes: [{ file: '../outside/evil.ts', type: 'rename' }],
      };

      const result = await refactorImpactTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(data.error).toMatch(/traversal/i);
    });
  });

  describe('code/split-suggest', () => {
    it('should have correct tool definition', () => {
      expect(splitSuggestTool.name).toBe('code/split-suggest');
      expect(splitSuggestTool.inputSchema.safeParse({}).success).toBe(false); // targetPath required
      const parsed = splitSuggestTool.inputSchema.safeParse({ targetPath: './src' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.strategy).toBe('minimize_coupling'); // default
      }
    });

    it('should handle valid input', async () => {
      const input = { targetPath: fixtureDir, targetModules: 2 };

      const result = await splitSuggestTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      expect(data.targetPath).toBe(fixtureDir);
      expect(data.strategy).toBe('minimize_coupling'); // default applied
      expect(Array.isArray(data.modules)).toBe(true);
      expect(data.modules.length).toBeGreaterThanOrEqual(1);
      expect(data.quality).toBeDefined();
      expect(data.migrationSteps.length).toBeGreaterThan(0);
      expect(typeof data.durationMs).toBe('number');
    });

    it('should reject missing targetPath', async () => {
      const result = await splitSuggestTool.handler({ targetModules: 2 } as any, context);
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
    });

    it('should reject targetModules outside valid range', async () => {
      for (const targetModules of [1, 51]) {
        const result = await splitSuggestTool.handler(
          { targetPath: fixtureDir, targetModules } as any,
          context,
        );
        const data = payload(result);
        expect(data.success).toBe(false);
      }
    });

    it('should reject path traversal in targetPath', async () => {
      const result = await splitSuggestTool.handler(
        { targetPath: '../outside' } as any,
        context,
      );
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(data.error).toMatch(/traversal/i);
    });
  });

  describe('code/learn-patterns', () => {
    it('should have correct tool definition', () => {
      expect(learnPatternsTool.name).toBe('code/learn-patterns');
      const parsed = learnPatternsTool.inputSchema.safeParse({});
      expect(parsed.success).toBe(true); // everything optional with defaults
      if (parsed.success) {
        expect(parsed.data.minOccurrences).toBe(3); // default
      }
    });

    it('should handle valid input', async () => {
      const input = {
        patternTypes: ['bug_patterns', 'refactor_patterns'],
        minOccurrences: 2,
      };

      const result = await learnPatternsTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      expect(Array.isArray(data.patterns)).toBe(true);
      expect(data.patterns.length).toBeGreaterThan(0);
      expect(data.summary.patternsFound).toBe(data.patterns.length);
      expect(data.summary.byType).toBeDefined();
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(typeof data.durationMs).toBe('number');
    });

    it('should reject minOccurrences outside valid range', async () => {
      for (const minOccurrences of [0, 101]) {
        const result = await learnPatternsTool.handler({ minOccurrences } as any, context);
        const data = payload(result);
        expect(data.success).toBe(false);
      }
    });

    it('should reject invalid pattern types', async () => {
      const result = await learnPatternsTool.handler(
        { patternTypes: ['not_a_pattern_type'] } as any,
        context,
      );
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
    });
  });

  describe('Security - Secret Masking', () => {
    it('should mask secrets in search results', async () => {
      const input = {
        query: 'apiKey configuration constants',
        scope: { paths: [fixtureDir] },
      };

      const result = await semanticSearchTool.handler(input as any, context);
      const data = payload(result);

      expect(data.success).toBe(true);
      const configHits = data.results.filter((r: any) => r.filePath.endsWith('config.ts'));
      expect(configHits.length).toBeGreaterThan(0);
      for (const r of data.results) {
        expect(r.snippet).not.toContain('sk_live_abc123xyz');
        expect(r.context).not.toContain('sk_live_abc123xyz');
      }
      expect(configHits[0].snippet).toContain('[REDACTED]');
    });

    it('should not mask when maskSecrets is disabled', async () => {
      const noMaskContext = createToolContext({ maskSecrets: false });
      const input = {
        query: 'apiKey configuration constants',
        scope: { paths: [fixtureDir] },
      };

      const result = await semanticSearchTool.handler(input as any, noMaskContext);
      const data = payload(result);

      expect(data.success).toBe(true);
      const configHits = data.results.filter((r: any) => r.filePath.endsWith('config.ts'));
      expect(configHits.length).toBeGreaterThan(0);
      expect(configHits[0].snippet).toContain('sk_live_abc123xyz');
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors gracefully (no throw, in-band error)', async () => {
      const result = await semanticSearchTool.handler({ query: '' } as any, context);
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(typeof data.error).toBe('string');
      expect(data.error.length).toBeGreaterThan(0);
    });

    it('should include durationMs in error responses', async () => {
      const result = await architectureAnalyzeTool.handler(
        { rootPath: 'a'.repeat(501) } as any,
        context,
      );
      const data = payload(result);

      expect(data.success).toBe(false);
      expect(typeof data.durationMs).toBe('number');
      expect(data.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance Reporting', () => {
    it('should include durationMs in successful results', async () => {
      const result = await architectureAnalyzeTool.handler(
        { rootPath: fixtureDir, analysis: ['dependency_graph'] } as any,
        context,
      );
      const data = payload(result);

      expect(data.success).toBe(true);
      expect(typeof data.durationMs).toBe('number');
      expect(data.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should attach the structured result as data alongside text content', async () => {
      const result = await semanticSearchTool.handler(
        { query: 'authentication login', scope: { paths: [fixtureDir] } } as any,
        context,
      );

      expect(result.data).toBeDefined();
      expect((result.data as any).success).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual(result.data);
    });
  });
});
