import { describe, expect, it } from 'vitest';

import { getFailedAgentRoles } from './agentBulkStart';

describe('getFailedAgentRoles', () => {
  it('returns roles for rejected results', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: true },
      { status: 'rejected', reason: new Error('boom') },
    ];

    expect(getFailedAgentRoles(results, ['planner', 'builder'])).toEqual(['builder']);
  });
});
