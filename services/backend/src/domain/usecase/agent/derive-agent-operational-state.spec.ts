import { describe, expect, test } from 'vitest';
import {
  deriveAgentOperationalState,
  deriveRoleOperationalState,
} from './derive-agent-operational-state';
const base = { role: 'builder', teamId: 'team', machineId: 'm' };
describe('derive agent operational state', () => {
  test.each([
    [{}, 'stopped', false, false, false],
    [{ desiredState: 'running' }, 'starting', false, false, true],
    [{ desiredState: 'running', spawnedAgentPid: 1 }, 'running', true, true, true],
    [{ desiredState: 'running', spawnedAgentPid: 1 }, 'running', true, false, false],
    [{ circuitState: 'open', spawnedAgentPid: 1 }, 'circuit_open', true, true, true],
  ])('derives role state', (extra, state, alive, running, daemon) => {
    const p = deriveRoleOperationalState({ ...base, ...extra }, daemon);
    expect(p.operationalState).toBe(state);
    expect(p.isAlive).toBe(alive);
    expect(p.isRunning).toBe(running);
  });
  test('summarizes no configs and offline alive roles', () => {
    const none = deriveAgentOperationalState({
      teamId: 'team',
      configs: [],
      daemonConnectedByMachineId: new Map(),
    });
    expect(none.summary.agentStatus).toBe('none');
    const result = deriveAgentOperationalState({
      teamId: 'team',
      configs: [{ ...base, spawnedAgentPid: 1 }],
      daemonConnectedByMachineId: new Map([['m', false]]),
    });
    expect(result.summary.aliveRoles).toEqual(['builder']);
    expect(result.summary.runningRoles).toEqual([]);
    expect(result.summary.agentStatus).toBe('stopped');
  });
});
