/**
 * Legal Contracts Plugin - MCP Tools Tests
 *
 * Tests for MCP tool handlers: registry surface, tool definitions (Zod input
 * schemas), success/error result envelopes, RBAC authorization, matter
 * isolation, and audit logging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clauseExtractTool,
  riskAssessTool,
  contractCompareTool,
  obligationTrackTool,
  playbookMatchTool,
  legalContractsTools,
  toolHandlers,
  createToolContext,
  type ToolContext,
} from '../src/mcp-tools.js';
import { LegalErrorCodes } from '../src/types.js';

// Mock context for testing: real bridges (via createToolContext) plus the
// governance fields (userId, userRoles, auditLogger, matterContext).
const createMockContext = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  ...createToolContext(),
  userId: 'test-user',
  userRoles: ['partner'],
  auditLogger: {
    log: vi.fn().mockResolvedValue(undefined),
  },
  matterContext: {
    matterId: 'matter-001',
    clientId: 'client-001',
  },
  ...overrides,
});

/** Parse the JSON text payload of a tool result */
const parsePayload = (result: { content: Array<{ type: 'text'; text: string }> }) =>
  JSON.parse(result.content[0]!.text);

describe('Legal Contracts MCP Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Registry', () => {
    it('should export all 5 tools', () => {
      expect(legalContractsTools).toHaveLength(5);
    });

    it('should have correct tool names', () => {
      const toolNames = legalContractsTools.map(t => t.name);
      expect(toolNames).toContain('legal/clause-extract');
      expect(toolNames).toContain('legal/risk-assess');
      expect(toolNames).toContain('legal/contract-compare');
      expect(toolNames).toContain('legal/obligation-track');
      expect(toolNames).toContain('legal/playbook-match');
    });

    it('should have category legal', () => {
      for (const tool of legalContractsTools) {
        expect(tool.category).toBe('legal');
      }
    });

    it('should have version 3.0.0-alpha.1', () => {
      for (const tool of legalContractsTools) {
        expect(tool.version).toBe('3.0.0-alpha.1');
      }
    });

    it('should look up a tool handler by name', () => {
      const handler = toolHandlers.get('legal/clause-extract');
      expect(handler).toBeDefined();
      expect(handler).toBe(clauseExtractTool.handler);
    });

    it('should return undefined for unknown tool', () => {
      const handler = toolHandlers.get('legal/unknown');
      expect(handler).toBeUndefined();
    });

    it('should register a handler for every tool name', () => {
      expect(toolHandlers.size).toBe(5);
      for (const tool of legalContractsTools) {
        expect(toolHandlers.get(tool.name)).toBeDefined();
      }
    });
  });

  describe('legal/clause-extract', () => {
    it('should have correct tool definition', () => {
      expect(clauseExtractTool.name).toBe('legal/clause-extract');
      expect(clauseExtractTool.description.length).toBeGreaterThan(0);
      // 'document' is required by the input schema
      expect(clauseExtractTool.inputSchema.safeParse({}).success).toBe(false);
      expect(clauseExtractTool.inputSchema.safeParse({ document: 'x' }).success).toBe(true);
    });

    it('should handle valid input', async () => {
      const input = {
        document: 'This Agreement is entered into between Party A and Party B. The Contractor shall indemnify the Client against all claims...',
        clauseTypes: ['indemnification', 'termination'],
        jurisdiction: 'US',
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = parsePayload(result);
      expect(data.success).toBe(true);
      expect(data.clauses).toBeDefined();
      expect(data.metadata).toBeDefined();
      expect(data.durationMs).toBeDefined();
    });

    it('should use default options', async () => {
      const input = {
        document: 'Contract text here...',
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = parsePayload(result);
      expect(data.success).toBe(true);
      // Schema applies the 'US' jurisdiction default
      const parsed = clauseExtractTool.inputSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as { jurisdiction: string }).jurisdiction).toBe('US');
      }
    });

    it('should handle matter context', async () => {
      const input = {
        document: 'Contract text...',
        matterContext: {
          matterId: 'matter-123',
          clientId: 'client-456',
        },
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should reject unauthorized access', async () => {
      const context = createMockContext({
        userRoles: ['client'], // No access to clause-extract
      });

      const input = {
        document: 'Contract text...',
      };

      const result = await clauseExtractTool.handler(input, context);

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.success).toBe(false);
      expect(data.code).toBe(LegalErrorCodes.MATTER_ACCESS_DENIED);
    });

    it('should reject document exceeding size limit', async () => {
      const input = {
        document: 'a'.repeat(10_000_001),
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.code).toBe(LegalErrorCodes.DOCUMENT_TOO_LARGE);
    });
  });

  describe('legal/risk-assess', () => {
    it('should have correct tool definition', () => {
      expect(riskAssessTool.name).toBe('legal/risk-assess');
      // 'document' and 'partyRole' are both required by the input schema
      expect(riskAssessTool.inputSchema.safeParse({ partyRole: 'buyer' }).success).toBe(false);
      expect(riskAssessTool.inputSchema.safeParse({ document: 'x' }).success).toBe(false);
      expect(riskAssessTool.inputSchema.safeParse({ document: 'x', partyRole: 'buyer' }).success).toBe(true);
    });

    it('should handle valid input', async () => {
      const input = {
        document: 'This Agreement contains various provisions...',
        partyRole: 'buyer',
        riskCategories: ['financial', 'legal'],
      };

      const result = await riskAssessTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = parsePayload(result);
      expect(data.risks).toBeDefined();
      expect(data.overallScore).toBeDefined();
      expect(data.grade).toBeDefined();
      expect(data.categorySummary).toBeDefined();
    });

    it('should handle industry context', async () => {
      const input = {
        document: 'Contract text...',
        partyRole: 'seller',
        industryContext: 'Healthcare',
        threshold: 'high',
      };

      const result = await riskAssessTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should reject missing partyRole', async () => {
      const input = {
        document: 'Contract text...',
      };

      const result = await riskAssessTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.success).toBe(false);
      expect(data.code).toBeDefined();
    });

    it('should reject invalid partyRole', async () => {
      const input = {
        document: 'Contract text...',
        partyRole: 'invalid_role',
      };

      const result = await riskAssessTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should handle all party roles', async () => {
      const roles = ['buyer', 'seller', 'licensor', 'licensee', 'employer', 'employee'] as const;

      for (const partyRole of roles) {
        const input = {
          document: 'Contract text...',
          partyRole,
        };

        const result = await riskAssessTool.handler(input, createMockContext());
        expect(result.isError).toBeUndefined();
      }
    });
  });

  describe('legal/contract-compare', () => {
    it('should have correct tool definition', () => {
      expect(contractCompareTool.name).toBe('legal/contract-compare');
      // 'baseDocument' and 'compareDocument' are both required
      expect(contractCompareTool.inputSchema.safeParse({ compareDocument: 'x' }).success).toBe(false);
      expect(contractCompareTool.inputSchema.safeParse({ baseDocument: 'x' }).success).toBe(false);
      expect(contractCompareTool.inputSchema.safeParse({ baseDocument: 'x', compareDocument: 'y' }).success).toBe(true);
    });

    it('should handle valid input', async () => {
      const input = {
        baseDocument: 'Original contract version...',
        compareDocument: 'Modified contract version...',
        comparisonMode: 'full',
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = parsePayload(result);
      expect(data.similarityScore).toBeDefined();
      expect(data.changes).toBeDefined();
      expect(data.summary).toBeDefined();
      expect(data.durationMs).toBeDefined();
    });

    it('should use default comparison mode', async () => {
      const input = {
        baseDocument: 'Base contract...',
        compareDocument: 'Compare contract...',
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = parsePayload(result);
      expect(data.mode).toBe('full'); // default
    });

    it('should handle focus clause types', async () => {
      const input = {
        baseDocument: 'Base contract...',
        compareDocument: 'Compare contract...',
        focusClauseTypes: ['termination', 'indemnification'],
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should handle all comparison modes', async () => {
      const modes = ['structural', 'semantic', 'full'] as const;

      for (const comparisonMode of modes) {
        const input = {
          baseDocument: 'Base...',
          compareDocument: 'Compare...',
          comparisonMode,
        };

        const result = await contractCompareTool.handler(input, createMockContext());
        expect(result.isError).toBeUndefined();
      }
    });

    it('should reject missing base document', async () => {
      const input = {
        compareDocument: 'Compare contract...',
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.success).toBe(false);
    });

    it('should reject documents exceeding size limit', async () => {
      const input = {
        baseDocument: 'a'.repeat(10_000_001),
        compareDocument: 'Compare...',
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.code).toBe(LegalErrorCodes.DOCUMENT_TOO_LARGE);
    });
  });

  describe('legal/obligation-track', () => {
    it('should have correct tool definition', () => {
      expect(obligationTrackTool.name).toBe('legal/obligation-track');
      // 'document' is required by the input schema
      expect(obligationTrackTool.inputSchema.safeParse({}).success).toBe(false);
      expect(obligationTrackTool.inputSchema.safeParse({ document: 'x' }).success).toBe(true);
    });

    it('should handle valid input', async () => {
      const input = {
        document: 'Agreement with obligations. The Buyer shall pay within 30 days.',
        party: 'Vendor Inc.',
        obligationTypes: ['payment', 'delivery'],
      };

      const result = await obligationTrackTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = parsePayload(result);
      expect(data.obligations).toBeDefined();
      expect(data.timeline).toBeDefined();
    });

    it('should handle minimal input', async () => {
      const input = {
        document: 'Contract with obligations...',
      };

      const result = await obligationTrackTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should handle timeframe filter', async () => {
      const input = {
        document: 'Contract text...',
        timeframe: 'next 30 days',
      };

      const result = await obligationTrackTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should handle all obligation types', async () => {
      const types = [
        'payment', 'delivery', 'notification', 'approval', 'compliance',
        'reporting', 'confidentiality', 'performance', 'insurance',
        'renewal', 'termination',
      ];

      const input = {
        document: 'Contract text...',
        obligationTypes: types,
      };

      const result = await obligationTrackTool.handler(input, createMockContext());
      expect(result.isError).toBeUndefined();
    });

    it('should reject missing document', async () => {
      const input = {
        party: 'Test Party',
      };

      const result = await obligationTrackTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.success).toBe(false);
    });
  });

  describe('legal/playbook-match', () => {
    it('should have correct tool definition', () => {
      expect(playbookMatchTool.name).toBe('legal/playbook-match');
      // 'document' and 'playbook' are both required
      expect(playbookMatchTool.inputSchema.safeParse({ playbook: '{}' }).success).toBe(false);
      expect(playbookMatchTool.inputSchema.safeParse({ document: 'x' }).success).toBe(false);
      expect(playbookMatchTool.inputSchema.safeParse({ document: 'x', playbook: '{}' }).success).toBe(true);
    });

    it('should handle valid input', async () => {
      const input = {
        document: 'Contract to evaluate. The Contractor shall indemnify the Client.',
        playbook: '{"id":"pb-1","name":"Test Playbook","contractType":"General","jurisdiction":"US","partyRole":"buyer","version":"1.0.0","positions":[]}',
        strictness: 'moderate',
      };

      const result = await playbookMatchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = parsePayload(result);
      expect(data.matches).toBeDefined();
      expect(data.summary).toBeDefined();
      expect(data.negotiationPriorities).toBeDefined();
    });

    it('should use default strictness', async () => {
      const input = {
        document: 'Contract...',
        playbook: '{}',
      };

      const result = await playbookMatchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      // Schema applies the 'moderate' strictness default
      const parsed = playbookMatchTool.inputSchema.safeParse(input);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as { strictness: string }).strictness).toBe('moderate');
      }
    });

    it('should handle priority clauses', async () => {
      const input = {
        document: 'Contract...',
        playbook: '{}',
        prioritizeClauses: ['indemnification', 'limitation_of_liability'],
      };

      const result = await playbookMatchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should handle all strictness levels', async () => {
      const levels = ['strict', 'moderate', 'flexible'] as const;

      for (const strictness of levels) {
        const input = {
          document: 'Contract...',
          playbook: '{}',
          strictness,
        };

        const result = await playbookMatchTool.handler(input, createMockContext());
        expect(result.isError).toBeUndefined();
      }
    });

    it('should reject unauthorized access (associate lacks playbook-match)', async () => {
      const context = createMockContext({
        userRoles: ['associate'], // No access to playbook-match
      });

      const input = {
        document: 'Contract...',
        playbook: '{}',
      };

      const result = await playbookMatchTool.handler(input, context);

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.code).toBe(LegalErrorCodes.MATTER_ACCESS_DENIED);
    });

    it('should reject playbook exceeding size limit', async () => {
      const input = {
        document: 'Contract...',
        playbook: 'a'.repeat(1_000_001),
      };

      const result = await playbookMatchTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.code).toBe(LegalErrorCodes.DOCUMENT_TOO_LARGE);
    });
  });

  describe('Authorization & Role Permissions', () => {
    it('should allow partner access to all tools', async () => {
      const context = createMockContext({
        userRoles: ['partner'],
      });

      // All tools should be accessible
      const tools = [
        { tool: clauseExtractTool, input: { document: 'Contract...' } },
        { tool: riskAssessTool, input: { document: 'Contract...', partyRole: 'buyer' } },
        { tool: contractCompareTool, input: { baseDocument: 'Base...', compareDocument: 'Compare...' } },
        { tool: obligationTrackTool, input: { document: 'Contract...' } },
        { tool: playbookMatchTool, input: { document: 'Contract...', playbook: '{}' } },
      ];

      for (const { tool, input } of tools) {
        const result = await tool.handler(input, context);
        expect(result.isError).toBeUndefined();
      }
    });

    it('should restrict paralegal access', async () => {
      const context = createMockContext({
        userRoles: ['paralegal'],
      });

      // Paralegal can access clause-extract and obligation-track
      const r1 = await clauseExtractTool.handler({ document: 'Contract...' }, context);
      expect(r1.isError).toBeUndefined();

      const r2 = await obligationTrackTool.handler({ document: 'Contract...' }, context);
      expect(r2.isError).toBeUndefined();

      // Paralegal cannot access risk-assess
      const r3 = await riskAssessTool.handler({ document: 'Contract...', partyRole: 'buyer' }, context);
      expect(r3.isError).toBe(true);
    });

    it('should deny client access to all tools', async () => {
      const context = createMockContext({
        userRoles: ['client'],
      });

      const r1 = await clauseExtractTool.handler({ document: 'Contract...' }, context);
      expect(r1.isError).toBe(true);
    });

    it('should allow access without roles (no RBAC)', async () => {
      const context = createMockContext({
        userRoles: undefined,
      });

      const result = await clauseExtractTool.handler({ document: 'Contract...' }, context);
      expect(result.isError).toBeUndefined();
    });
  });

  describe('Matter Isolation', () => {
    it('should include matter context in audit logs', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({
        auditLogger,
        matterContext: { matterId: 'matter-001', clientId: 'client-001' },
      });

      await clauseExtractTool.handler({ document: 'Contract...' }, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          matterId: 'matter-001',
        })
      );
    });
  });

  describe('Audit Logging', () => {
    it('should log successful operations', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger });

      await clauseExtractTool.handler({ document: 'Contract...' }, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'clause-extract',
          userId: 'test-user',
          success: true,
        })
      );
    });

    it('should include document hash in audit', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger });

      await clauseExtractTool.handler({ document: 'Contract...' }, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          documentHash: expect.any(String),
        })
      );
    });

    it('should log failed operations with success=false', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger, userRoles: ['client'] });

      await clauseExtractTool.handler({ document: 'Contract...' }, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'clause-extract',
          success: false,
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors gracefully', async () => {
      const input = {
        document: '', // Empty document
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.error).toBe(true);
      expect(data.success).toBe(false);
    });

    it('should include error code in response', async () => {
      const context = createMockContext({
        userRoles: ['client'], // Unauthorized
      });

      const result = await clauseExtractTool.handler({ document: 'Contract...' }, context);

      expect(result.isError).toBe(true);
      const data = parsePayload(result);
      expect(data.code).toBeDefined();
      expect(data.code).toBe(LegalErrorCodes.MATTER_ACCESS_DENIED);
    });
  });

  describe('Performance', () => {
    it('should include analysis time in results', async () => {
      const input = {
        document: 'Contract text for extraction...',
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = parsePayload(result);
      expect(data.durationMs).toBeDefined();
      expect(typeof data.durationMs).toBe('number');
    });
  });
});
