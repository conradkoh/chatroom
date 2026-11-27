import { getFunctionName } from 'convex/server';
import { describe, expect, test, vi } from 'vitest';

import {
  getAgentConfig,
  listAgentModels,
  listAgents,
  setAgentConfig,
  startAgent,
} from './index.js';
import { api } from '../../api.js';

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

const appliedResult = {
  role: 'solo',
  outcome: 'restarted' as const,
  running: true,
  previous: { agentHarness: 'claude-sdk', model: 'old-model' },
  effective: {
    agentHarness: 'codex-sdk',
    model: 'gpt-5.6-luna[reasoning=low]',
    machineId: 'machine_1',
    workingDir: '/work/repo',
    workspaceId: 'ws_1',
  },
  correlationId: 'corr_1',
};

function output(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => String(call[0])).join('\n');
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
      },
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await getAgentConfig('room_1', 'solo', d);
    expect(d.backend.query).toHaveBeenCalled();
    expect(log.mock.calls.join('\n')).toContain('codex-sdk');
    log.mockRestore();
  });

  test('set calls applyConfig exactly once with the requested config', async () => {
    const d = deps();
    d.backend.mutation.mockResolvedValue(appliedResult);
    d.machine.getMachineId.mockResolvedValue(null);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await setAgentConfig(
      'room_1',
      { role: 'solo', harness: 'codex-sdk', model: 'gpt-5.6-luna[reasoning=low]' },
      d
    );

    expect(d.backend.mutation).toHaveBeenCalledTimes(1);
    expect(d.backend.mutation).toHaveBeenCalledWith(api.agents.applyConfig, {
      sessionId: 'session_1',
      chatroomId: 'room_1',
      role: 'solo',
      agentHarness: 'codex-sdk',
      model: 'gpt-5.6-luna[reasoning=low]',
    });
    log.mockRestore();
  });

  test('set prints the restarted outcome', async () => {
    const d = deps();
    d.backend.mutation.mockResolvedValue(appliedResult);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await setAgentConfig('room_1', { role: 'solo', harness: 'codex-sdk', model: 'm' }, d);

    const text = output(log);
    expect(text).toContain('✅ Restart requested for solo');
    expect(text).toContain('  Harness: codex-sdk (was claude-sdk)');
    expect(text).toContain('Agent restarted with the new configuration.');
    log.mockRestore();
  });

  test('set prints the saved-and-not-running outcome', async () => {
    const d = deps();
    d.backend.mutation.mockResolvedValue({
      ...appliedResult,
      outcome: 'saved',
      running: false,
      previous: null,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await setAgentConfig('room_1', { role: 'solo', harness: 'codex-sdk', model: 'm' }, d);

    const text = output(log);
    expect(text).toContain('✅ Saved solo (not running)');
    expect(text).toContain('  Harness: codex-sdk (was none)');
    expect(text).toContain(
      'The agent is not running; the new configuration is used the next time it starts.'
    );
    log.mockRestore();
  });

  test('set prints the saved-while-running outcome', async () => {
    const d = deps();
    d.backend.mutation.mockResolvedValue({
      ...appliedResult,
      outcome: 'saved',
      running: true,
      previous: null,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await setAgentConfig('room_1', { role: 'solo', harness: 'codex-sdk', model: 'm' }, d);

    const text = output(log);
    expect(text).toContain('✅ Saved solo');
    expect(text).not.toContain('✅ Saved solo (not running)');
    expect(text).toContain('The running agent has no managed configuration and was not restarted.');
    log.mockRestore();
  });

  test('set prints the unchanged outcome without a was-suffix', async () => {
    const d = deps();
    d.backend.mutation.mockResolvedValue({
      ...appliedResult,
      outcome: 'unchanged',
      previous: {
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
      },
      effective: {
        ...appliedResult.effective,
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
      },
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await setAgentConfig('room_1', { role: 'solo', harness: 'codex-sdk', model: 'm' }, d);

    const text = output(log);
    expect(text).toContain(
      'No change: solo already uses codex-sdk / gpt-5.6-luna[reasoning=low]; not restarted'
    );
    expect(text).not.toContain('(was ');
    log.mockRestore();
  });

  test('set propagates a backend error', async () => {
    const d = deps();
    d.backend.mutation.mockRejectedValue(
      new Error("Agent harness 'pi-sdk' is not available on this machine")
    );

    await expect(
      setAgentConfig('room_1', { role: 'solo', harness: 'pi-sdk', model: 'm' }, d)
    ).rejects.toThrow("Agent harness 'pi-sdk' is not available on this machine");
  });

  test('starts an agent using saved config defaults', async () => {
    const d = deps([
      {
        role: 'solo',
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
        workingDir: '/workspace',
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
        }),
      })
    );
  });

  test('list merges team, statuses and launch requests', async () => {
    const d = deps();
    d.backend.query.mockImplementation(async (endpoint: unknown) => {
      const name = getFunctionName(endpoint as Parameters<typeof getFunctionName>[0]);
      if (name === 'chatrooms:getTeamStructureForChatroom') {
        return { teamId: 'trio', teamName: 'Trio', entryPoint: 'coordinator' };
      }
      if (name === 'agents:listStatus') {
        return [
          { role: 'planner', roleKind: 'persistent', status: 'offline' },
          {
            role: 'builder',
            roleKind: 'persistent',
            status: 'working',
            machineId: 'machine_1',
            workingDir: '/work/repo',
          },
          { role: 'reviewer', roleKind: 'ephemeral', status: 'offline' },
        ];
      }
      return [
        {
          role: 'Builder',
          agentHarness: 'codex-sdk',
          model: 'old-model',
          workingDir: '/work/repo',
          machineId: 'machine_1',
          requestedAt: 100,
        },
        {
          role: 'builder',
          agentHarness: 'opencode-sdk',
          model: 'openai/gpt-4',
          workingDir: '/work/repo',
          machineId: 'machine_1',
          requestedAt: 200,
        },
      ];
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await listAgents('room_1', d);

    const text = output(log);
    expect(text).toContain('Team: trio (Trio)    Entry point: coordinator    Chatroom: room_1');
    expect(text.indexOf('planner (permanent)')).toBeLessThan(text.indexOf('builder (permanent)'));
    expect(text.indexOf('builder (permanent)')).toBeLessThan(text.indexOf('reviewer (ephemeral)'));
    expect(text).toContain('planner (permanent)\n  Status: offline\n  Harness: (not configured)');
    expect(text).toContain('builder (permanent)\n  Status: working\n  Harness: opencode-sdk');
    expect(text).toContain('  Machine ID: machine_1');
    expect(text).toContain('reviewer (ephemeral)\n  Status: offline');
    log.mockRestore();
  });

  test('list fails clearly without a team structure', async () => {
    const d = deps();
    d.backend.query.mockImplementation(async (endpoint: unknown) =>
      getFunctionName(endpoint as Parameters<typeof getFunctionName>[0]) ===
      'chatrooms:getTeamStructureForChatroom'
        ? null
        : []
    );
    await expect(listAgents('room_1', d)).rejects.toThrow('Chatroom has no team structure: room_1');
  });

  test('models omits the harness filter when not given and passes it when given', async () => {
    const d = deps();
    d.backend.query.mockResolvedValue({
      role: 'builder',
      teamId: 'trio',
      machineId: 'machine_1',
      current: null,
      harnesses: [],
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await listAgentModels('room_1', { team: 'trio', role: 'builder' }, d);
    const unfiltered = d.backend.query.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(unfiltered).not.toHaveProperty('harness');

    await listAgentModels('room_1', { team: 'trio', role: 'builder', harness: 'codex-sdk' }, d);
    const filtered = d.backend.query.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(filtered.harness).toBe('codex-sdk');
    log.mockRestore();
  });

  test('models prints available harnesses and marks the current one', async () => {
    const d = deps();
    d.backend.query.mockResolvedValue({
      role: 'builder',
      teamId: 'trio',
      machineId: 'machine_1',
      current: { agentHarness: 'codex-sdk', model: 'm1' },
      harnesses: [
        { harness: 'codex-sdk', models: ['m1', 'm2'], isCurrent: true },
        { harness: 'opencode-sdk', models: [], isCurrent: false },
      ],
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await listAgentModels('room_1', { team: 'trio', role: 'builder' }, d);

    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain(
      'Models for builder (team trio) on machine machine_1; current: codex-sdk / m1'
    );
    expect(lines).toContain('Harness: codex-sdk (current)');
    expect(lines).toContain('  m1');
    expect(lines).toContain('  m2');
    expect(lines).toContain('Harness: opencode-sdk');
    expect(lines).toContain('  (no models reported; any model id is accepted)');
    log.mockRestore();
  });

  test('models propagates a backend error', async () => {
    const d = deps();
    d.backend.query.mockRejectedValue(new Error('Chatroom uses team trio, not solo'));

    await expect(listAgentModels('room_1', { team: 'solo', role: 'builder' }, d)).rejects.toThrow(
      'Chatroom uses team trio, not solo'
    );
  });
});
