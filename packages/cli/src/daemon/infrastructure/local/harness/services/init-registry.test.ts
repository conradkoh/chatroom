/**
 * Tests for the harness service registry init.
 *
 * Verifies that all expected harnesses (including opencode-sdk) are registered
 * after `initHarnessRegistry()` runs. Guards against the registry getting out
 * of sync with new harness additions.
 */

import { describe, expect, it } from 'vitest';

import { initHarnessRegistry, getHarness, getAllHarnesses } from './index.js';

describe('initHarnessRegistry', () => {
  it('registers the opencode-sdk harness', () => {
    initHarnessRegistry();
    const service = getHarness('opencode-sdk');
    expect(service).toBeDefined();
    expect(service?.id).toBe('opencode-sdk');
    expect(service?.displayName).toBe('OpenCode (SDK)');
  });

  it('registers the claude-sdk harness with correct display name', () => {
    initHarnessRegistry();
    const service = getHarness('claude-sdk');
    expect(service).toBeDefined();
    expect(service?.id).toBe('claude-sdk');
    expect(service?.displayName).toBe('Claude (SDK)');
  });

  it('registers all expected harnesses', () => {
    initHarnessRegistry();
    const ids = getAllHarnesses()
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(
      [
        'claude',
        'claude-sdk',
        'commandcode',
        'copilot',
        'cursor',
        'cursor-sdk',
        'opencode',
        'opencode-sdk',
        'pi',
        'pi-sdk',
      ].sort()
    );
  });
});
