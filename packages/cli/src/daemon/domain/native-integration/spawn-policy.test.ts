import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent.js';
import { describe, expect, test } from 'vitest';

import { resolveNativeSpawnPolicy } from './spawn-policy.js';

describe('resolveNativeSpawnPolicy', () => {
  test.each(['claude-sdk', 'codex-sdk', 'cursor-sdk', 'opencode-sdk', 'pi-sdk'] as const)(
    'defers the initial turn and uses native bootstrap for %s',
    (harness) => {
      const policy = resolveNativeSpawnPolicy(harness, 'hello');
      expect(policy.deferInitialTurn).toBe(true);
      expect(policy.prompt).toBeDefined();
    }
  );

  test('does not defer when no harness is configured', () => {
    const policy = resolveNativeSpawnPolicy(undefined as unknown as AgentHarness, 'hello');
    expect(policy.deferInitialTurn).toBe(false);
    expect(policy.prompt).toBeDefined();
  });
});
