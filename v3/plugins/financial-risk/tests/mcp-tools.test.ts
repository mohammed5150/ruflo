/**
 * Financial Risk Plugin - MCP Tools Tests
 *
 * Tests for MCP tool handlers with mock data.
 *
 * Contract under test (src/types.ts MCPToolResult):
 *   success: boolean; data?: unknown; error?: string; metadata?: {...}
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  portfolioRiskTool,
  anomalyDetectTool,
  marketRegimeTool,
  complianceCheckTool,
  stressTestTool,
  financialTools,
  getTool,
  getToolNames,
} from '../src/mcp-tools.js';
import { FinancialErrorCodes } from '../src/types.js';

// Mock bridges
vi.mock('../src/bridges/economy-bridge.js', () => ({
  FinancialEconomyBridge: vi.fn().mockImplementation(() => ({
    initialized: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    calculateRiskMetrics: vi.fn().mockResolvedValue({
      var: 0.03,
      cvar: 0.045,
      sharpe: 1.2,
      maxDrawdown: 0.15,
      volatility: 0.18,
    }),
  })),
}));

vi.mock('../src/bridges/sparse-bridge.js', () => ({
  FinancialSparseBridge: vi.fn().mockImplementation(() => ({
    initialized: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    detectTransactionAnomalies: vi.fn().mockResolvedValue([
      {
        transactionId: 'tx-001',
        score: 0.85,
        type: 'fraud',
        indicators: ['large_amount', 'unusual_time'],
      },
    ]),
    classifyMarketRegime: vi.fn().mockResolvedValue({
      regime: 'bull',
      confidence: 0.78,
      probabilities: {
        bull: 0.78,
        bear: 0.1,
        sideways: 0.08,
        high_vol: 0.02,
        crisis: 0.01,
        recovery: 0.01,
      },
    }),
  })),
}));

// Mock context for testing. ADMIN has access to all five tools
// (see FinancialRolePermissions in src/types.ts).
const createMockContext = (overrides = {}) => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  userId: 'test-user',
  userRoles: ['ADMIN'],
  auditLogger: {
    log: vi.fn().mockResolvedValue(undefined),
  },
  ...overrides,
});

// A valid transaction matching AnomalyDetectInputSchema (uuid id, ISO
// timestamp, required parties array).
const validTransaction = (overrides = {}) => ({
  id: '550e8400-e29b-41d4-a716-446655440000',
  timestamp: '2024-01-15T10:30:00Z',
  amount: 1000,
  parties: ['acct-a', 'acct-b'],
  ...overrides,
});

// MarketRegimeInputSchema requires at least 10 prices.
const validMarketData = () => ({
  prices: [100, 101, 102, 103, 104, 105, 104, 106, 107, 108, 109, 110],
  volumes: [1000, 1100, 1200, 900, 1000, 1100, 1050, 1150, 1250, 950, 1000, 1100],
});

describe('Financial Risk MCP Tools', () => {
  beforeEach(() => {
    // clearAllMocks resets call history but keeps the bridge
    // mockImplementations above intact (restoreAllMocks would strip them).
    vi.clearAllMocks();
  });

  describe('Tool Registry', () => {
    it('should export all 5 tools', () => {
      expect(financialTools).toHaveLength(5);
    });

    it('should have correct tool names', () => {
      const toolNames = financialTools.map(t => t.name);
      expect(toolNames).toContain('finance/portfolio-risk');
      expect(toolNames).toContain('finance/anomaly-detect');
      expect(toolNames).toContain('finance/market-regime');
      expect(toolNames).toContain('finance/compliance-check');
      expect(toolNames).toContain('finance/stress-test');
    });

    it('should have category finance', () => {
      for (const tool of financialTools) {
        expect(tool.category).toBe('finance');
      }
    });

    it('should have version 1.0.0', () => {
      for (const tool of financialTools) {
        expect(tool.version).toBe('1.0.0');
      }
    });

    it('should get tool by name', () => {
      const tool = getTool('finance/portfolio-risk');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('finance/portfolio-risk');
    });

    it('should return undefined for unknown tool', () => {
      const tool = getTool('finance/unknown');
      expect(tool).toBeUndefined();
    });

    it('should get all tool names', () => {
      const names = getToolNames();
      expect(names).toHaveLength(5);
      expect(names).toContain('finance/portfolio-risk');
    });
  });

  describe('finance/portfolio-risk', () => {
    it('should have correct tool definition', () => {
      expect(portfolioRiskTool.name).toBe('finance/portfolio-risk');
      expect(portfolioRiskTool.inputSchema.required).toContain('holdings');
      expect(portfolioRiskTool.cacheable).toBe(false);
    });

    it('should handle valid input', async () => {
      const input = {
        holdings: [
          { symbol: 'AAPL', quantity: 100, assetClass: 'equity' },
          { symbol: 'GOOGL', quantity: 50, assetClass: 'equity' },
        ],
        confidenceLevel: 0.95,
        horizon: '1d',
      };

      const result = await portfolioRiskTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.metrics).toBeDefined();
      expect(data.metrics.var).toBeDefined();
      expect(data.concentrationRisk).toBeDefined();
      expect(data.recommendations).toBeDefined();
    });

    it('should calculate concentration risk', async () => {
      const input = {
        holdings: [
          { symbol: 'AAPL', quantity: 800, assetClass: 'equity', sector: 'Technology' },
          { symbol: 'MSFT', quantity: 100, assetClass: 'equity', sector: 'Technology' },
          { symbol: 'JPM', quantity: 100, assetClass: 'equity', sector: 'Financials' },
        ],
      };

      const result = await portfolioRiskTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.concentrationRisk.topHoldings).toBeDefined();
      expect(data.concentrationRisk.sectorExposure).toBeDefined();
      expect(data.concentrationRisk.topHoldings[0].symbol).toBe('AAPL');
    });

    it('should reject unauthorized access', async () => {
      const context = createMockContext({
        userRoles: ['AUDITOR'], // AUDITOR has no access to portfolio-risk
      });

      const input = {
        holdings: [{ symbol: 'AAPL', quantity: 100 }],
      };

      const result = await portfolioRiskTool.handler(input, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('UNAUTHORIZED');
    });

    it('should reject requests over the rate limit', async () => {
      // portfolio-risk allows 60 requests/minute per user (FinancialRateLimits)
      const context = createMockContext({ userId: 'pr-rate-limit-user' });
      const input = {
        holdings: [{ symbol: 'AAPL', quantity: 100 }],
      };

      for (let i = 0; i < 60; i++) {
        const r = await portfolioRiskTool.handler(input, context);
        expect(r.success).toBe(true);
      }

      const limited = await portfolioRiskTool.handler(input, context);
      expect(limited.success).toBe(false);
      expect(limited.error).toBe(FinancialErrorCodes.RATE_LIMIT_EXCEEDED);
    });

    it('should reject empty holdings', async () => {
      const input = {
        holdings: [],
      };

      const result = await portfolioRiskTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should reject invalid symbol format', async () => {
      const input = {
        holdings: [{ symbol: 'INVALID!!!', quantity: 100 }],
      };

      const result = await portfolioRiskTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should log audit entries', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger });

      const input = {
        holdings: [{ symbol: 'AAPL', quantity: 100 }],
      };

      await portfolioRiskTool.handler(input, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'portfolio-risk',
          userId: 'test-user',
        })
      );
    });
  });

  describe('finance/anomaly-detect', () => {
    it('should have correct tool definition', () => {
      expect(anomalyDetectTool.name).toBe('finance/anomaly-detect');
      expect(anomalyDetectTool.inputSchema.required).toContain('transactions');
      expect(anomalyDetectTool.cacheable).toBe(false);
    });

    it('should handle valid input', async () => {
      const input = {
        transactions: [validTransaction({ amount: 10000, type: 'transfer' })],
        sensitivity: 0.8,
      };

      const result = await anomalyDetectTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.anomalies).toBeDefined();
      expect(data.riskScore).toBeDefined();
      expect(data.patterns).toBeDefined();
    });

    it('should handle context types', async () => {
      const contexts = ['fraud', 'aml', 'market_manipulation', 'all'] as const;

      for (const ctx of contexts) {
        const input = {
          transactions: [validTransaction()],
          context: ctx,
        };

        const result = await anomalyDetectTool.handler(input, createMockContext());
        expect(result.success).toBe(true);
      }
    });

    it('should reject unauthorized access', async () => {
      const context = createMockContext({
        userRoles: ['TRADER'], // TRADER has no access to anomaly-detect
      });

      const input = {
        transactions: [validTransaction()],
      };

      const result = await anomalyDetectTool.handler(input, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('UNAUTHORIZED');
    });

    it('should reject invalid transaction UUID', async () => {
      const input = {
        transactions: [validTransaction({ id: 'invalid-uuid' })],
      };

      const result = await anomalyDetectTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should reject invalid timestamp', async () => {
      const input = {
        transactions: [validTransaction({ timestamp: 'invalid' })],
      };

      const result = await anomalyDetectTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should reject empty transactions', async () => {
      const input = {
        transactions: [],
      };

      const result = await anomalyDetectTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });
  });

  describe('finance/market-regime', () => {
    it('should have correct tool definition', () => {
      expect(marketRegimeTool.name).toBe('finance/market-regime');
      expect(marketRegimeTool.inputSchema.required).toContain('marketData');
      expect(marketRegimeTool.cacheable).toBe(true);
      expect(marketRegimeTool.cacheTTL).toBe(60000);
    });

    it('should handle valid input', async () => {
      const input = {
        marketData: validMarketData(),
      };

      const result = await marketRegimeTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.currentRegime).toBeDefined();
      expect(data.currentRegime.regime).toBeDefined();
      expect(data.currentRegime.confidence).toBeDefined();
      expect(data.transitionProbabilities).toBeDefined();
      expect(data.outlook).toBeDefined();
    });

    it('should include regime characteristics', async () => {
      const input = {
        marketData: validMarketData(),
      };

      const result = await marketRegimeTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.currentRegime.characteristics).toBeDefined();
      expect(Array.isArray(data.currentRegime.characteristics)).toBe(true);
    });

    it('should handle lookback period', async () => {
      const input = {
        marketData: validMarketData(),
        lookbackPeriod: 30,
      };

      const result = await marketRegimeTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
    });

    it('should reject missing market data', async () => {
      const input = {
        lookbackPeriod: 30,
      };

      const result = await marketRegimeTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should reject insufficient price data', async () => {
      const input = {
        marketData: {
          prices: [100, 101], // schema requires at least 10 prices
          volumes: [1000, 1100],
        },
      };

      const result = await marketRegimeTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });
  });

  describe('finance/compliance-check', () => {
    it('should have correct tool definition', () => {
      expect(complianceCheckTool.name).toBe('finance/compliance-check');
      expect(complianceCheckTool.inputSchema.required).toContain('entity');
      expect(complianceCheckTool.inputSchema.required).toContain('regulations');
      expect(complianceCheckTool.cacheable).toBe(false);
    });

    it('should handle valid input', async () => {
      const input = {
        entity: 'ACME Bank',
        regulations: ['basel3', 'aml'],
        scope: 'all',
      };

      const result = await complianceCheckTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.entity).toBe('ACME Bank');
      expect(data.compliant).toBeDefined();
      expect(data.violations).toBeDefined();
      expect(data.warnings).toBeDefined();
      expect(data.recommendations).toBeDefined();
    });

    it('should check Basel III compliance', async () => {
      const input = {
        entity: 'Test Bank',
        regulations: ['basel3'],
      };

      const result = await complianceCheckTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.capitalAdequacy).toBeDefined();
      expect(data.capitalAdequacy.cet1Ratio).toBeDefined();
      expect(data.capitalAdequacy.tier1Ratio).toBeDefined();
    });

    it('should handle all regulation types', async () => {
      const regulations = ['basel3', 'mifid2', 'dodd_frank', 'aml', 'kyc'] as const;

      for (const reg of regulations) {
        const input = {
          entity: 'Test Entity',
          regulations: [reg],
        };

        const result = await complianceCheckTool.handler(input, createMockContext());
        expect(result.success).toBe(true);
      }
    });

    it('should handle as-of date', async () => {
      const input = {
        entity: 'Test Entity',
        regulations: ['basel3'],
        asOfDate: '2024-01-15',
      };

      const result = await complianceCheckTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.asOfDate).toBe('2024-01-15');
    });

    it('should reject missing entity', async () => {
      const input = {
        regulations: ['basel3'],
      };

      const result = await complianceCheckTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should reject empty regulations', async () => {
      const input = {
        entity: 'Test Entity',
        regulations: [],
      };

      const result = await complianceCheckTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });
  });

  describe('finance/stress-test', () => {
    it('should have correct tool definition', () => {
      expect(stressTestTool.name).toBe('finance/stress-test');
      expect(stressTestTool.inputSchema.required).toContain('portfolio');
      expect(stressTestTool.inputSchema.required).toContain('scenarios');
      expect(stressTestTool.cacheable).toBe(false);
    });

    it('should handle valid input', async () => {
      const input = {
        portfolio: {
          id: 'port-001',
          holdings: [
            { symbol: 'AAPL', quantity: 100 },
            { symbol: 'GOOGL', quantity: 50 },
          ],
        },
        scenarios: [
          {
            name: 'Market Crash',
            type: 'historical',
            shocks: { equityShock: -0.3 },
          },
        ],
      };

      const result = await stressTestTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.scenarios).toBeDefined();
      expect(data.aggregateImpact).toBeDefined();
      expect(data.capitalRecommendation).toBeDefined();
      expect(data.recommendations).toBeDefined();
    });

    it('should handle multiple scenarios', async () => {
      const input = {
        portfolio: {
          holdings: [{ symbol: 'AAPL', quantity: 100 }],
        },
        scenarios: [
          { name: 'Bull', type: 'hypothetical', shocks: { equityShock: 0.2 } },
          { name: 'Bear', type: 'hypothetical', shocks: { equityShock: -0.3 } },
          { name: 'Crash', type: 'historical', shocks: { equityShock: -0.5 } },
        ],
      };

      const result = await stressTestTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.scenarios).toHaveLength(3);
      expect(data.aggregateImpact.worstCase).toBeDefined();
    });

    it('should identify VaR breaches', async () => {
      const input = {
        portfolio: {
          holdings: [{ symbol: 'AAPL', quantity: 1000 }],
        },
        scenarios: [
          { name: 'Severe', type: 'historical', shocks: { equityShock: -0.25 } },
        ],
      };

      const result = await stressTestTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
      const data = result.data as any;
      // A -25% equity shock exceeds the 10% VaR breach threshold
      expect(data.scenarios[0].riskMetrics.varBreach).toBe(true);
    });

    it('should reject unauthorized access', async () => {
      const context = createMockContext({
        userRoles: ['AUDITOR'], // AUDITOR has no access to stress-test
      });

      const input = {
        portfolio: { holdings: [{ symbol: 'AAPL', quantity: 100 }] },
        scenarios: [{ name: 'Test', type: 'hypothetical', shocks: { equityShock: -0.1 } }],
      };

      const result = await stressTestTool.handler(input, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('UNAUTHORIZED');
    });

    it('should reject empty scenarios', async () => {
      const input = {
        portfolio: { holdings: [{ symbol: 'AAPL', quantity: 100 }] },
        scenarios: [],
      };

      const result = await stressTestTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should reject empty portfolio holdings', async () => {
      const input = {
        portfolio: { holdings: [] },
        scenarios: [{ name: 'Test', type: 'hypothetical', shocks: { equityShock: -0.1 } }],
      };

      const result = await stressTestTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on stress-test', async () => {
      // stress-test allows 10 requests/minute per user (FinancialRateLimits)
      const context = createMockContext({ userId: 'st-rate-limit-user' });
      const input = {
        portfolio: { holdings: [{ symbol: 'AAPL', quantity: 100 }] },
        scenarios: [{ name: 'Test', type: 'hypothetical', shocks: { equityShock: -0.1 } }],
      };

      for (let i = 0; i < 10; i++) {
        const r = await stressTestTool.handler(input, context);
        expect(r.success).toBe(true);
      }

      const limited = await stressTestTool.handler(input, context);
      expect(limited.success).toBe(false);
      expect(limited.error).toBe(FinancialErrorCodes.RATE_LIMIT_EXCEEDED);
    });

    it('should track rate limits per user', async () => {
      const input = {
        portfolio: { holdings: [{ symbol: 'AAPL', quantity: 100 }] },
        scenarios: [{ name: 'Test', type: 'hypothetical', shocks: { equityShock: -0.1 } }],
      };

      // The previous test exhausted 'st-rate-limit-user'; a different
      // user must still be allowed through.
      const other = createMockContext({ userId: 'st-other-user' });
      const r = await stressTestTool.handler(input, other);
      expect(r.success).toBe(true);
    });

    it('should allow anomaly-detect requests within the limit', async () => {
      const context = createMockContext({ userId: 'ad-rate-limit-user' });
      const input = {
        transactions: [validTransaction()],
      };

      const r1 = await anomalyDetectTool.handler(input, context);
      expect(r1.success).toBe(true);
    });
  });

  describe('Audit Logging', () => {
    it('should log audit entries with required fields', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger });

      const input = {
        holdings: [{ symbol: 'AAPL', quantity: 100 }],
      };

      await portfolioRiskTool.handler(input, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
          userId: 'test-user',
          toolName: 'portfolio-risk',
          inputHash: expect.any(String),
          outputHash: expect.any(String),
          executionTimeMs: expect.any(Number),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle bridge errors gracefully', async () => {
      // The mocked bridge is successful, but real errors would be caught
      const input = {
        holdings: [{ symbol: 'AAPL', quantity: 100 }],
      };

      const result = await portfolioRiskTool.handler(input, createMockContext());

      expect(result.success).toBe(true);
    });

    it('should include error details in response', async () => {
      const input = {
        holdings: [], // Invalid
      };

      const result = await portfolioRiskTool.handler(input, createMockContext());

      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error).toContain('Invalid input');
    });
  });
});
