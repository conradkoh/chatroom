import { AGENT_HARNESSES } from '@workspace/backend/src/domain/entities/agent.js';
import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';
import { describe, expect, test } from 'vitest';

import { resolveNativeSpawnPolicy } from './spawn-policy.js';

describe('shouldDeferInitialTurn', () => {
  test('matches supportsNativeIntegration for every harness', () => {
    for (const harness of AGENT_HARNESSES) {
      expect(resolveNativeSpawnPolicy(harness, '').deferInitialTurn).toBe(
        getHarnessCapabilities(harness).supportsNativeIntegration
      );
    }
  });
});

describe('resolveNativeSpawnPolicy', () => {
  test('defers and uses native bootstrap for cursor-sdk', () => {
    const policy = resolveNativeSpawnPolicy('cursor-sdk', 'hello');
    expect(policy.deferInitialTurn).toBe(true);
    expect(policy.prompt).toBeDefined();
  });

  test('does not defer for CLI harnesses', () => {
    const policy = resolveNativeSpawnPolicy('opencode', 'hello');
    expect(policy.deferInitialTurn).toBe(false);
    expect(policy.prompt).toBeDefined();
  });
});
