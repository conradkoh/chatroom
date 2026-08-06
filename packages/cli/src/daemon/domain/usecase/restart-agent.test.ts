import { describe, expect, it, vi } from 'vitest';

import { restartAgent, type RestartAgentDeps, type RestartAgentInput } from './restart-agent.js';

const baseInput: RestartAgentInput = {
  commandId: 'cmd-1',
  chatroomId: 'room-1',
  machineId: 'machine-1',
  role: 'builder',
  agentHarness: 'cursor',
  model: 'gpt-4',
  workingDir: '/workspace',
  correlationId: 'corr-1',
  deadline: Date.now() + 60_000,
  wantResume: true,
};

function makeDeps(overrides?: Partial<RestartAgentDeps>): RestartAgentDeps {
  return {
    restartOrchestrator: {
      runRestart: vi.fn().mockResolvedValue(undefined),
    },
    now: () => Date.now(),
    log: vi.fn(),
    ...overrides,
  };
}

describe('restartAgent', () => {
  it('skips orchestrator when deadline expired', async () => {
    const deps = makeDeps({ now: () => Date.now() + 1000 });
    const runRestart = vi.fn();
    deps.restartOrchestrator.runRestart = runRestart;

    await restartAgent(deps, { ...baseInput, deadline: Date.now() - 1 });

    expect(runRestart).not.toHaveBeenCalled();
  });

  it('calls restart orchestrator with full payload', async () => {
    const deps = makeDeps();

    await restartAgent(deps, baseInput);

    expect(deps.restartOrchestrator.runRestart).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      machineId: 'machine-1',
      role: 'builder',
      agentHarness: 'cursor',
      model: 'gpt-4',
      workingDir: '/workspace',
      correlationId: 'corr-1',
      wantResume: true,
    });
  });

  it('swallows orchestrator errors', async () => {
    const deps = makeDeps();
    deps.restartOrchestrator.runRestart = vi
      .fn()
      .mockRejectedValue(new Error('orchestrator failed'));

    await expect(restartAgent(deps, baseInput)).resolves.toBeUndefined();
  });
});
