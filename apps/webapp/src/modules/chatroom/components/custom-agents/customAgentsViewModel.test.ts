import { AgentRoleLifecycleTag } from '@workspace/shared/domain/agent-role';
import { describe, expect, it } from 'vitest';

import {
  MACHINE_AGENTS_ROOT,
  buildCustomAgentsViewModel,
  type TeamRosterResult,
} from './customAgentsViewModel';

function builtin(role: string): TeamRosterResult['roster'][number] {
  return {
    role,
    lifecycle: AgentRoleLifecycleTag.Permanent,
    source: 'builtin',
    summary: `${role} summary`,
    disabled: false,
    disableable: false,
  };
}

function custom(
  role: string,
  options: { scope?: 'workspace' | 'machine'; disabled?: boolean } = {}
): TeamRosterResult['roster'][number] {
  return {
    role,
    lifecycle: AgentRoleLifecycleTag.Ephemeral,
    source: 'custom',
    summary: `${role} summary`,
    disabled: options.disabled ?? false,
    disableable: true,
    scope: options.scope ?? 'workspace',
  };
}

function source(
  scope: 'workspace' | 'machine',
  overrides: Partial<TeamRosterResult['sources'][number]> = {}
): TeamRosterResult['sources'][number] {
  return {
    scope,
    machineId: 'machine-1',
    ...(scope === 'workspace' ? { workingDir: '/ws' } : {}),
    agentCount: 1,
    issues: [],
    updatedAt: 100,
    ...overrides,
  };
}

function result(overrides: Partial<TeamRosterResult> = {}): TeamRosterResult {
  return {
    roster: [builtin('planner'), custom('alpha')],
    sources: [source('workspace'), source('machine')],
    ...overrides,
  };
}

describe('workspace root path', () => {
  it('appends the agents directory and trims trailing slashes', () => {
    expect(buildCustomAgentsViewModel(result(), '/repo').sources[0].rootPath).toBe(
      '/repo/.chatroom/agents'
    );
    expect(buildCustomAgentsViewModel(result(), '/repo///').sources[0].rootPath).toBe(
      '/repo/.chatroom/agents'
    );
  });
});

describe('buildCustomAgentsViewModel rows', () => {
  it('drops builtin roles', () => {
    const model = buildCustomAgentsViewModel(result(), '/ws');

    expect(model.rows.map((row) => row.name)).toEqual(['alpha']);
  });

  it('sorts rows by name', () => {
    const model = buildCustomAgentsViewModel(
      result({ roster: [custom('gamma'), custom('alpha'), custom('beta')] }),
      '/ws'
    );

    expect(model.rows.map((row) => row.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('keeps a disabled row in its sorted position', () => {
    const model = buildCustomAgentsViewModel(
      result({ roster: [custom('alpha'), custom('beta', { disabled: true }), custom('gamma')] }),
      '/ws'
    );

    expect(model.rows.map((row) => [row.name, row.disabled])).toEqual([
      ['alpha', false],
      ['beta', true],
      ['gamma', false],
    ]);
  });

  it('maps summary, scope, and the disable flag', () => {
    const model = buildCustomAgentsViewModel(
      result({ roster: [custom('alpha', { scope: 'machine', disabled: true })] }),
      '/ws'
    );

    expect(model.rows[0]).toEqual({
      name: 'alpha',
      description: 'alpha summary',
      scope: 'machine',
      disabled: true,
      disableable: true,
      overridesMachineCopy: false,
    });
  });

  it('marks overridesMachineCopy only for a shadowed workspace row', () => {
    const model = buildCustomAgentsViewModel(
      result({
        roster: [custom('alpha', { scope: 'workspace' }), custom('beta', { scope: 'machine' })],
        sources: [
          source('workspace'),
          source('machine', { issues: [{ path: 'alpha', reason: 'shadowed' }] }),
        ],
      }),
      '/ws'
    );

    expect(model.rows.find((row) => row.name === 'alpha')?.overridesMachineCopy).toBe(true);
    expect(model.rows.find((row) => row.name === 'beta')?.overridesMachineCopy).toBe(false);
  });
});

describe('buildCustomAgentsViewModel sources', () => {
  it('always returns [workspace, machine] in that order', () => {
    const model = buildCustomAgentsViewModel(result(), '/ws');

    expect(model.sources.map((entry) => entry.scope)).toEqual(['workspace', 'machine']);
    expect(model.sources[0].rootPath).toBe('/ws/.chatroom/agents');
    expect(model.sources[1].rootPath).toBe(MACHINE_AGENTS_ROOT);
  });

  it('reports pushed: null and no issues when a source has never pushed', () => {
    const model = buildCustomAgentsViewModel(result({ sources: [] }), '/ws');

    expect(model.sources[0].pushed).toBeNull();
    expect(model.sources[1].pushed).toBeNull();
    expect(model.sources[0].issues).toEqual([]);
  });

  it('counts enabled, disabled, and issues', () => {
    const model = buildCustomAgentsViewModel(
      result({
        roster: [custom('alpha'), custom('beta', { disabled: true })],
        sources: [
          source('workspace', { issues: [{ path: 'a', reason: 'gitignored' }] }),
          source('machine', {
            issues: [
              { path: 'b', reason: 'shadowed' },
              { path: 'c', reason: 'over-limit' },
            ],
          }),
        ],
      }),
      '/ws'
    );

    expect(model.enabledCount).toBe(1);
    expect(model.disabledCount).toBe(1);
    expect(model.issueCount).toBe(3);
  });
});

describe('changeSignature', () => {
  it('changes when a row is toggled', () => {
    const before = buildCustomAgentsViewModel(result(), '/ws');
    const after = buildCustomAgentsViewModel(
      result({ roster: [builtin('planner'), custom('alpha', { disabled: true })] }),
      '/ws'
    );

    expect(after.changeSignature).not.toBe(before.changeSignature);
  });

  it('changes when a source updatedAt moves', () => {
    const before = buildCustomAgentsViewModel(result(), '/ws');
    const after = buildCustomAgentsViewModel(
      result({ sources: [source('workspace', { updatedAt: 200 }), source('machine')] }),
      '/ws'
    );

    expect(after.changeSignature).not.toBe(before.changeSignature);
  });

  it('changes when an issue is added', () => {
    const before = buildCustomAgentsViewModel(result(), '/ws');
    const after = buildCustomAgentsViewModel(
      result({
        sources: [
          source('workspace'),
          source('machine', { issues: [{ path: 'x', reason: 'unreadable' }] }),
        ],
      }),
      '/ws'
    );

    expect(after.changeSignature).not.toBe(before.changeSignature);
  });

  it('is stable for an identical result', () => {
    expect(buildCustomAgentsViewModel(result(), '/ws').changeSignature).toBe(
      buildCustomAgentsViewModel(result(), '/ws').changeSignature
    );
  });
});
