import { describe, expect, it, vi } from 'vitest';

import { startAgent, type StartAgentDeps, type StartAgentInput } from './start-agent.js';

const baseInput: StartAgentInput = {
  commandId: 'cmd-1',
  chatroomId: 'room-1',
  role: 'builder',
  agentHarness: 'cursor',
  model: 'gpt-4',
  workingDir: '/workspace',
  reason: 'user.start',
  deadline: Date.now() + 60_000,
  wantResume: true,
};

function makeDeps(overrides?: Partial<StartAgentDeps>): StartAgentDeps {
  return {
    agentProcessManager: {
      ensureRunning: vi.fn().mockResolvedValue({ success: true }),
    },
    session: {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      hostname: 'host-1',
      emitAgentStartFailed: vi.fn().mockResolvedValue(undefined),
      registerWorkspace: vi.fn().mockResolvedValue(undefined),
    },
    now: () => Date.now(),
    log: vi.fn(),
    ...overrides,
  };
}

describe('startAgent', () => {
  it('skips ensureRunning when deadline expired', async () => {
    const deps = makeDeps({ now: () => Date.now() + 1000 });
    const ensureRunning = vi.fn();
    deps.agentProcessManager.ensureRunning = ensureRunning;

    await startAgent(deps, { ...baseInput, deadline: Date.now() - 1 });

    expect(ensureRunning).not.toHaveBeenCalled();
  });

  it('registers workspace on success', async () => {
    const deps = makeDeps();

    await startAgent(deps, baseInput);

    expect(deps.agentProcessManager.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'room-1',
        role: 'builder',
        wantResume: true,
      })
    );
    expect(deps.session.registerWorkspace).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workingDir: '/workspace',
      registeredBy: 'builder',
    });
    expect(deps.session.emitAgentStartFailed).not.toHaveBeenCalled();
  });

  it('forwards maxReasoningLevel to ensureRunning', async () => {
    const deps = makeDeps();

    await startAgent(deps, { ...baseInput, maxReasoningLevel: 'medium' });

    expect(deps.agentProcessManager.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({ maxReasoningLevel: 'medium' })
    );
  });

  it('emits startFailed when ensureRunning fails', async () => {
    const deps = makeDeps();
    deps.agentProcessManager.ensureRunning = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'rate limited' });

    await startAgent(deps, baseInput);

    expect(deps.session.emitAgentStartFailed).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      error: 'rate limited',
    });
    expect(deps.session.registerWorkspace).not.toHaveBeenCalled();
  });
});
