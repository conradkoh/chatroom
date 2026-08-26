import { describe, expect, test } from 'vitest';

import {
  applyRoleToSummary,
  deriveAgentOperationalState,
  deriveAgentRoleViewState,
  deriveRoleOperationalState,
  removeRoleFromSummary,
  recomputeAgentStatus,
} from './derive-agent-operational-state';

const base = { role: 'builder', teamId: 'team', machineId: 'm' };
describe('derive agent operational state', () => {
  test('reports running when PID alive despite desiredState stopped', () => {
    expect(deriveAgentRoleViewState({ desiredState: 'stopped', spawnedAgentPid: 42 }, true)).toBe(
      'running'
    );
  });
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
  test('applies and removes role deltas while preserving alive/running arrays', () => {
    const summary = {
      teamId: 'team',
      agentStatus: 'none' as const,
      runningRoles: [],
      aliveRoles: [],
      runningAgents: [],
      remoteConfigCount: 0,
    };
    const projection = deriveRoleOperationalState({ ...base, spawnedAgentPid: 1 }, true);
    const running = applyRoleToSummary(summary, projection, { isNewConfig: true });
    expect(running.remoteConfigCount).toBe(1);
    expect(running.agentStatus).toBe('running');
    expect(running.runningRoles).toEqual(['builder']);
    expect(running.aliveRoles).toEqual(['builder']);
    expect(running.runningAgents).toEqual([{ role: 'builder', machineId: 'm' }]);
    const removed = removeRoleFromSummary(running, 'builder');
    expect(removed.remoteConfigCount).toBe(0);
    expect(removed.agentStatus).toBe('none');
    expect(removed.runningRoles).toEqual([]);
    expect(removed.aliveRoles).toEqual([]);
  });
  test('recomputes none, stopped, and running statuses from summary deltas', () => {
    expect(recomputeAgentStatus({ remoteConfigCount: 0, runningRoles: [] })).toBe('none');
    expect(recomputeAgentStatus({ remoteConfigCount: 1, runningRoles: [] })).toBe('stopped');
    expect(recomputeAgentStatus({ remoteConfigCount: 1, runningRoles: ['builder'] })).toBe(
      'running'
    );
  });
  test('adding a second role increments remoteConfigCount to two', () => {
    const emptySummary = {
      teamId: 'team',
      agentStatus: 'none' as const,
      runningRoles: [],
      aliveRoles: [],
      runningAgents: [],
      remoteConfigCount: 0,
    };
    let summary = applyRoleToSummary(
      emptySummary,
      deriveRoleOperationalState({ ...base, spawnedAgentPid: 1 }, true),
      { isNewConfig: true }
    );
    summary = applyRoleToSummary(
      summary,
      deriveRoleOperationalState({ ...base, role: 'planner', desiredState: 'running' }, true),
      { isNewConfig: true }
    );
    expect(summary.remoteConfigCount).toBe(2);
  });
  test('updating an existing role leaves remoteConfigCount unchanged', () => {
    const emptySummary = {
      teamId: 'team',
      agentStatus: 'none' as const,
      runningRoles: [],
      aliveRoles: [],
      runningAgents: [],
      remoteConfigCount: 0,
    };
    let summary = applyRoleToSummary(
      emptySummary,
      deriveRoleOperationalState({ ...base, spawnedAgentPid: 1 }, true),
      { isNewConfig: true }
    );
    summary = applyRoleToSummary(
      summary,
      deriveRoleOperationalState({ ...base, spawnedAgentPid: 2 }, true),
      { isNewConfig: false }
    );
    expect(summary.remoteConfigCount).toBe(1);
  });
});
