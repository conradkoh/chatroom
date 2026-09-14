import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';

describe('canonical agent reads', () => {
  test('lists permanent team roles before any launch request exists', async () => {
    const sessionId = 'canonical-agent-roles';
    const login = await t.mutation(api.auth.loginAnon, { sessionId: sessionId as any });
    expect(login.success).toBe(true);
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId: sessionId as any,
      teamStructureId: 'duo@1',
    });

    const requests = await t.query(api.agents.listLastSentLaunchRequests, {
      sessionId: sessionId as any,
      chatroomId,
    });
    const statuses = await t.query(api.agents.listStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    expect(requests).toEqual([]);
    expect(statuses.map((status) => status.role)).toEqual(['planner', 'enhancer', 'builder']);
    expect(statuses.filter((status) => !status.optional).map((status) => status.role)).toEqual([
      'planner',
      'builder',
    ]);
    expect(statuses.every((status) => status.status === 'offline')).toBe(true);
  });
});
