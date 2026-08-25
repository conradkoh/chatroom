import { describe, expect, it, vi } from 'vitest';

import { stopAgentScope } from './stop-agent-scope.js';

const make = (role: string, pid: number) => ({
  chatroomId: 'c',
  role,
  pid,
  agentHarness: 'h',
  machineId: 'm',
  targetKey: `m:${role}:${pid}`,
});
function setup(targets: ReturnType<typeof make>[]) {
  const release = vi.fn();
  const d = {
    machineId: 'm',
    barrier: { acquire: vi.fn(async () => release) },
    discovery: { listTargets: vi.fn(async () => targets) },
    harnessStop: { stop: vi.fn(async () => {}) },
    liveness: { isAlive: vi.fn(() => false) },
    lifecycle: { awaitExitedFact: vi.fn(async () => {}) },
    buildRevisionKey: vi.fn(() => 'r'),
  };
  return { d, release };
}
describe('stopAgentScope', () => {
  it('stops all targets for chatroom scope', async () => {
    const { d } = setup([make('a', 1), make('b', 2)]);
    const r = await stopAgentScope(d, {
      chatroomId: 'c',
      scope: { kind: 'chatroom' },
      reason: 'user.stop',
    });
    expect(r.targets).toHaveLength(2);
  });
  it('matches agent roles case-insensitively', async () => {
    const { d } = setup([make('Builder', 1), make('reviewer', 2)]);
    const r = await stopAgentScope(d, {
      chatroomId: 'c',
      scope: { kind: 'agent', role: 'builder' },
      reason: 'user.stop',
    });
    expect(r.targets).toHaveLength(1);
  });
  it('releases the barrier on failures', async () => {
    const { d, release } = setup([make('a', 1)]);
    d.lifecycle.awaitExitedFact.mockRejectedValue(new Error('x'));
    const r = await stopAgentScope(d, {
      chatroomId: 'c',
      scope: { kind: 'chatroom' },
      reason: 'user.stop',
    });
    expect(r.failures).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('returns empty discovery', async () => {
    const { d } = setup([]);
    await expect(
      stopAgentScope(d, { chatroomId: 'c', scope: { kind: 'chatroom' }, reason: 'user.stop' })
    ).resolves.toEqual({ targets: [], failures: [] });
  });
});
