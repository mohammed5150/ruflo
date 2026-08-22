/**
 * Regression: a failed bridge init must be diagnosable and recoverable.
 *
 * `getRegistry()` latches `bridgeAvailable = false` for the life of the
 * process, so one transient init failure routes every later write to the
 * sql.js whole-image fallback — which then refuses whenever -wal/-shm
 * sidecars are present. Observed in the wild: an MCP server silently dropped
 * every `memory_store` for hours while CLI writes through the same database
 * succeeded, and the only symptom was a refusal naming a cause the operator
 * could not check.
 *
 * Three properties close that:
 *   1. the failure reason is recorded rather than swallowed by a bare catch;
 *   2. `shutdownBridge()` clears the latch even when init never produced a
 *      registry — previously the reset sat inside `if (registryInstance)`,
 *      which is null in exactly the case needing a reset;
 *   3. a degradation notice is never filtered out as init noise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the init failure under test deterministically: mock the
// `@claude-flow/memory` import inside getRegistry() to throw. (Previously this
// file relied on the package being unresolvable at runtime, but with the v3
// workspace installed the real import succeeds, the bridge genuinely
// initializes, and the "failed init" premise silently evaporates — writing
// test entries into a real database along the way.) The assertions
// deliberately check the recorded/cleared behaviour rather than the flavour
// of the underlying error, which is not the property that matters. The mock
// factory is lazy, so the suites below that never trigger getRegistry()
// (Windows gate, log suppression) are unaffected.
vi.mock('@claude-flow/memory', () => {
  throw new Error('simulated @claude-flow/memory init failure (regression harness)');
});

describe('bridge failure diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should report null before the bridge has been tried', async () => {
    const { getBridgeFailureReason } = await import('../src/memory/memory-bridge.js');

    expect(getBridgeFailureReason()).toBeNull();
  });

  it('should record why init failed instead of swallowing the error', async () => {
    const bridge = await import('../src/memory/memory-bridge.js');

    await bridge.bridgeStoreEntry({ key: 'k', value: 'v' });

    const reason = bridge.getBridgeFailureReason();
    expect(reason).toBeTruthy();
    expect(typeof reason).toBe('string');
  });

  it('should return null from bridgeStoreEntry so the caller falls back', async () => {
    const bridge = await import('../src/memory/memory-bridge.js');

    const result = await bridge.bridgeStoreEntry({ key: 'k', value: 'v' });

    expect(result).toBeNull();
  });

  it('should clear the latched failure on shutdown even with no registry instance', async () => {
    const bridge = await import('../src/memory/memory-bridge.js');
    await bridge.bridgeStoreEntry({ key: 'k', value: 'v' });
    expect(bridge.getBridgeFailureReason()).toBeTruthy();

    await bridge.shutdownBridge();

    expect(bridge.getBridgeFailureReason()).toBeNull();
  });

  it('should re-attempt init after shutdown rather than staying latched', async () => {
    const bridge = await import('../src/memory/memory-bridge.js');
    await bridge.bridgeStoreEntry({ key: 'k', value: 'v' });
    await bridge.shutdownBridge();
    expect(bridge.getBridgeFailureReason()).toBeNull();

    // A latched `bridgeAvailable === false` short-circuits getRegistry() before
    // it retries, so the reason would stay null. Repopulating it proves the
    // retry actually happened.
    await bridge.bridgeStoreEntry({ key: 'k2', value: 'v2' });

    expect(bridge.getBridgeFailureReason()).toBeTruthy();
  });
});

describe('#3024 Windows native-bridge safety gate', () => {
  it('disables the native bridge on Windows by default', async () => {
    const { shouldDisableNativeBridge } = await import('../src/memory/memory-bridge.js');

    expect(shouldDisableNativeBridge('win32', {})).toBe(true);
  });

  it('allows an explicit Windows diagnostic opt-in', async () => {
    const { shouldDisableNativeBridge } = await import('../src/memory/memory-bridge.js');

    expect(shouldDisableNativeBridge('win32', {
      CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS: '1',
    })).toBe(false);
  });

  it('keeps the explicit disable flag authoritative on every platform', async () => {
    const { shouldDisableNativeBridge } = await import('../src/memory/memory-bridge.js');

    expect(shouldDisableNativeBridge('linux', { CLAUDE_FLOW_DISABLE_BRIDGE: '1' })).toBe(true);
    expect(shouldDisableNativeBridge('win32', {
      CLAUDE_FLOW_DISABLE_BRIDGE: '1',
      CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS: '1',
    })).toBe(true);
  });

  it('leaves the native bridge enabled by default off Windows', async () => {
    const { shouldDisableNativeBridge } = await import('../src/memory/memory-bridge.js');

    expect(shouldDisableNativeBridge('linux', {})).toBe(false);
    expect(shouldDisableNativeBridge('darwin', {})).toBe(false);
  });
});

describe('init log suppression', () => {
  it('should suppress a noisy init banner', async () => {
    const { shouldSuppressInitLog } = await import('../src/memory/memory-bridge.js');

    expect(shouldSuppressInitLog('[AgentDB] Initialized with better-sqlite3 + ruvector')).toBe(true);
  });

  it('should NOT suppress the better-sqlite3 fallback notice', async () => {
    const { shouldSuppressInitLog } = await import('../src/memory/memory-bridge.js');

    expect(shouldSuppressInitLog('[AgentDB] better-sqlite3 not available, using sql.js WASM')).toBe(false);
  });

  it('should NOT suppress a generic falling-back notice', async () => {
    const { shouldSuppressInitLog } = await import('../src/memory/memory-bridge.js');

    expect(shouldSuppressInitLog('[HNSWLibBackend] falling back to brute force')).toBe(false);
  });

  it('should leave unrelated output alone', async () => {
    const { shouldSuppressInitLog } = await import('../src/memory/memory-bridge.js');

    expect(shouldSuppressInitLog('user-facing progress line')).toBe(false);
  });
});
