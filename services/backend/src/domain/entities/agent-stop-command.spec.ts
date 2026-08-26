import { describe, expect, test } from 'vitest';
import { agentStopScopeKey, buildAgentStopTargetKey, buildAgentStopRevisionKey } from './agent-stop-command';
import { agentStopReasonValidator } from './agent';

describe('agent stop command entity', () => {
  test('normalizes role scope keys for coalescing', () => {
    expect(agentStopScopeKey({ kind: 'chatroom' })).toBe('chatroom');
    expect(agentStopScopeKey({ kind: 'agent', role: ' Builder ' })).toBe('agent:builder');
  });
  test('builds stable target and revision keys', () => {
    const targetKey = buildAgentStopTargetKey({ machineId: 'm1', role: 'Builder', pid: 42 });
    expect(targetKey).toBe('m1:builder:42');
    expect(buildAgentStopRevisionKey({ stopCommandId: 'cmd', targetKey })).toBe('cmd:m1:builder:42');
  });
  test('uses agent reason SSOT', () => {
    expect(agentStopReasonValidator).toBeDefined();
  });
});
