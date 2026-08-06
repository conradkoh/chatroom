import { describe, expect, it, vi } from 'vitest';

import { stopAgent, type StopAgentDeps, type StopAgentInput } from './stop-agent.js';

const baseInput: StopAgentInput = {
  chatroomId: 'room-1',
  role: 'builder',
  reason: 'user.stop',
  deadline: Date.now() + 60_000,
};

function makeDeps(overrides?: Partial<StopAgentDeps>): StopAgentDeps {
  return {
    agentProcessManager: {
      stop: vi.fn().mockResolvedValue({ success: true }),
    },
    now: () => Date.now(),
    log: vi.fn(),
    ...overrides,
  };
}

describe('stopAgent', () => {
  it('skips stop when deadline expired', async () => {
    const deps = makeDeps({ now: () => Date.now() + 1000 });
    const stop = vi.fn();
    deps.agentProcessManager.stop = stop;

    const result = await stopAgent(deps, { ...baseInput, deadline: Date.now() - 1 });

    expect(stop).not.toHaveBeenCalled();
    expect(result.failed).toBe(false);
  });

  it('returns success CommandResult when stop succeeds', async () => {
    const deps = makeDeps();

    const result = await stopAgent(deps, baseInput);

    expect(deps.agentProcessManager.stop).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      reason: 'user.stop',
      pid: undefined,
    });
    expect(result.failed).toBe(false);
    expect(result.result).toContain('Agent stopped');
  });

  it('returns failed CommandResult when stop fails', async () => {
    const deps = makeDeps();
    deps.agentProcessManager.stop = vi.fn().mockResolvedValue({ success: false });

    const result = await stopAgent(deps, baseInput);

    expect(result.failed).toBe(true);
    expect(result.result).toContain('Failed to stop agent');
  });
});
