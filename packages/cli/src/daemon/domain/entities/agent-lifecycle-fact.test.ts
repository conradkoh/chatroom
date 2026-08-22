import { describe, expect, it } from 'vitest';

import { buildExitedLifecycleFact, normalizeAgentLifecycleFact } from './agent-lifecycle-fact.js';

describe('agent lifecycle fact helpers', () => {
  it('buildExitedLifecycleFact omits audit-only fields', () => {
    const fact = buildExitedLifecycleFact(
      {
        sessionId: 'sess',
        machineId: 'machine',
        chatroomId: 'room',
        role: 'builder',
        pid: 0,
        stopReason: 'user.stop',
      },
      1_000
    );
    expect(fact).toEqual({
      kind: 'exited',
      chatroomId: 'room',
      role: 'builder',
      pid: 0,
      stopReason: 'user.stop',
      revisionKey: 'exited:chatroomId=room:role=builder:pid=0:emittedAt=1000',
      emittedAt: 1_000,
    });
    expect(fact).not.toHaveProperty('sessionId');
    expect(fact).not.toHaveProperty('machineId');
  });

  it('normalizeAgentLifecycleFact strips legacy audit fields from exited facts', () => {
    const fact = normalizeAgentLifecycleFact({
      kind: 'exited',
      sessionId: 'sess',
      machineId: 'machine',
      chatroomId: 'room',
      role: 'planner',
      pid: 0,
      stopReason: 'user.stop',
      revisionKey: 'exited:legacy',
      emittedAt: 2_000,
    });
    expect(fact).toEqual({
      kind: 'exited',
      chatroomId: 'room',
      role: 'planner',
      pid: 0,
      stopReason: 'user.stop',
      revisionKey: 'exited:legacy',
      emittedAt: 2_000,
    });
  });
});
