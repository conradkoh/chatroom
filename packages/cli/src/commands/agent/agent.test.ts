import { describe, expect, test, vi } from 'vitest';

import { getAgentConfig, setAgentConfig, startAgent } from './index.js';

function deps(configs: unknown[] = []) {
  return {
    backend: {
      query: vi.fn().mockResolvedValue(configs),
      mutation: vi.fn().mockResolvedValue({}),
    },
    session: { getSessionId: vi.fn().mockResolvedValue('session_1') },
    machine: {
      getMachineId: vi.fn().mockResolvedValue('machine_1'),
      loadMachineConfig: vi.fn().mockResolvedValue({ workingDir: '/workspace' }),
    },
  };
}

describe('agent commands', () => {
  test('gets config for a role', async () => {
    const d = deps([
      {
        role: 'solo',
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
        workingDir: '/workspace',
        machineId: 'machine_1',
        desiredState: 'running',
        maxReasoningLevel: 'high',
      },
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await getAgentConfig('room_1', 'solo', d);
    expect(d.backend.query).toHaveBeenCalled();
    expect(log.mock.calls.join('\n')).toContain('codex-sdk');
    expect(log.mock.calls.join('\n')).toContain('high');
    log.mockRestore();
  });

  test('sets remote config with maxReasoningLevel', async () => {
    const d = deps();
    await setAgentConfig(
      'room_1',
      {
        role: 'solo',
        harness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
        maxReasoningLevel: 'medium',
      },
      d
    );
    expect(d.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        maxReasoningLevel: 'medium',
      })
    );
  });

  test('sets remote config with machine and resolved working directory', async () => {
    const d = deps();
    await setAgentConfig(
      'room_1',
      { role: 'solo', harness: 'codex-sdk', model: 'gpt-5.6-luna[reasoning=low]' },
      d
    );
    expect(d.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chatroomId: 'room_1',
        role: 'solo',
        type: 'remote',
        machineId: 'machine_1',
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
        workingDir: '/workspace',
      })
    );
  });

  test('starts an agent using saved config defaults', async () => {
    const d = deps([
      {
        role: 'solo',
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
        workingDir: '/workspace',
        maxReasoningLevel: 'high',
      },
    ]);
    await startAgent('room_1', { role: 'solo' }, d);
    expect(d.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        machineId: 'machine_1',
        type: 'start-agent',
        payload: expect.objectContaining({
          role: 'solo',
          agentHarness: 'codex-sdk',
          model: 'gpt-5.6-luna[reasoning=low]',
          maxReasoningLevel: 'high',
        }),
      })
    );
  });

  test('start override sends maxReasoningLevel in payload', async () => {
    const d = deps([
      {
        role: 'solo',
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
        workingDir: '/workspace',
        maxReasoningLevel: 'high',
      },
    ]);
    await startAgent('room_1', { role: 'solo', maxReasoningLevel: 'low' }, d);
    expect(d.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ maxReasoningLevel: 'low' }),
      })
    );
  });

  test('requires a registered machine', async () => {
    const d = deps();
    d.machine.getMachineId.mockResolvedValue(null);
    await expect(
      setAgentConfig('room_1', { role: 'solo', harness: 'codex-sdk', model: 'model' }, d)
    ).rejects.toThrow('Run machine daemon start first');
  });
});
