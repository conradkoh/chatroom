import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultHarnessFactory } from './harness-registry.js';

vi.mock('./infrastructure/harnesses/opencode-sdk/index.js', () => ({
  createOpencodeSdkHarness: vi.fn(() => ({ harnessName: 'opencode-sdk' })),
}));

describe('defaultHarnessFactory', () => {
  it('returns a DirectHarnessSpawner for opencode-sdk', () => {
    const harness = defaultHarnessFactory('opencode-sdk');
    expect(harness).toBeDefined();
    expect(harness.harnessName).toBe('opencode-sdk');
  });

  it('throws an error for unknown harness names', () => {
    expect(() => defaultHarnessFactory('unknown-harness')).toThrow('Unknown harness');
    expect(() => defaultHarnessFactory('unknown-harness')).toThrow('opencode-sdk');
  });
});
