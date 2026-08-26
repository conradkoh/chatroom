import { describe, expect, test } from 'vitest';

import { getExecutionKindForRole, isTeamAgentRole, isDaemonWorkerRole } from './execution-kind.js';

describe('execution-kind', () => {
  test('enhancer is team_agent (ephemeral team role)', () => {
    expect(getExecutionKindForRole('enhancer')).toBe('team_agent');
    expect(isTeamAgentRole('enhancer')).toBe(true);
    expect(isDaemonWorkerRole('enhancer')).toBe(false);
  });

  test('planner is team_agent', () => {
    expect(getExecutionKindForRole('planner')).toBe('team_agent');
    expect(isTeamAgentRole('planner')).toBe(true);
    expect(isDaemonWorkerRole('planner')).toBe(false);
  });

  test('builder is team_agent', () => {
    expect(getExecutionKindForRole('builder')).toBe('team_agent');
    expect(isTeamAgentRole('builder')).toBe(true);
    expect(isDaemonWorkerRole('builder')).toBe(false);
  });

  test('unknown role defaults to team_agent', () => {
    expect(getExecutionKindForRole('unknown')).toBe('team_agent');
    expect(isTeamAgentRole('unknown')).toBe(true);
    expect(isDaemonWorkerRole('unknown')).toBe(false);
  });

  test('case-insensitive role matching', () => {
    expect(getExecutionKindForRole('ENHANCER')).toBe('team_agent');
    expect(getExecutionKindForRole('Enhancer')).toBe('team_agent');
  });
});
