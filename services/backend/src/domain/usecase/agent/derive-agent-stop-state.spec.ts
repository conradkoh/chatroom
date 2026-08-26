import { describe, expect, test } from 'vitest';
import { t } from '../../../../test.setup';
import { deriveRoleStopState } from './derive-agent-stop-state';

describe('deriveRoleStopState', () => {
  test('returns idle without stop commands', async () => {
    const result = await t.run(async (ctx) =>
      deriveRoleStopState(ctx, 'missing' as never, 'builder', {
        isAlive: true,
        desiredState: 'running',
      })
    );
    expect(result.stopState).toBe('idle');
  });
});
