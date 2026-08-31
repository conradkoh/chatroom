import { describe, expect, it, vi } from 'vitest';

import { recoverAgentState, type RecoverAgentStateDeps } from './recover-agent-state.js';

function makeDeps(overrides?: Partial<RecoverAgentStateDeps>): RecoverAgentStateDeps {
  return {
    agentProcessManager: {
      recover: vi.fn().mockResolvedValue(undefined),
      listActive: vi.fn().mockReturnValue([]),
    },
    backend: {
      getMachineAgentConfigs: vi.fn().mockResolvedValue({ configs: [] }),
      registerWorkspace: vi.fn().mockResolvedValue(undefined),
    },
    session: {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      hostname: 'host-1',
    },
    log: vi.fn(),
    warn: vi.fn(),
    ...overrides,
  };
}

describe('recoverAgentState', () => {
  it('logs and returns when no active slots after recovery', async () => {
    const deps = makeDeps();

    await recoverAgentState(deps);

    expect(deps.agentProcessManager.recover).toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith('   No active agents after recovery');
    expect(deps.backend.getMachineAgentConfigs).not.toHaveBeenCalled();
  });

  it('re-registers workspaces for active slots', async () => {
    const deps = makeDeps();
    deps.agentProcessManager.listActive = vi
      .fn()
      .mockReturnValue([{ chatroomId: 'room-1', role: 'builder' }]);
    deps.backend.getMachineAgentConfigs = vi.fn().mockResolvedValue({
      configs: [
        { machineId: 'machine-1', workingDir: '/workspace', role: 'builder' },
        { machineId: 'other-machine', workingDir: '/other', role: 'builder' },
      ],
    });

    await recoverAgentState(deps);

    expect(deps.backend.getMachineAgentConfigs).toHaveBeenCalledWith('room-1');
    expect(deps.backend.registerWorkspace).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      workingDir: '/workspace',
      registeredBy: 'builder',
    });
    expect(deps.log).toHaveBeenCalledWith('   🔀 Registered 1 workspace(s) on recovery');
  });
});
