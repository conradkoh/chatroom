import { describe, expect, test } from 'vitest';

import { deriveRoleStopState } from './derive-agent-stop-state';
import { t } from '../../../../test.setup';

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
