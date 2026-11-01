import { describe, expect, it } from 'vitest';

import { listCustomAgents } from './list.js';

/** The roster shape `customAgents.getTeamRoster` returns, trimmed to what we read. */
const roster = {
  roster: [
    {
      role: 'planner',
      lifecycle: 'builtin',
      source: 'builtin' as const,
      summary: 'Plans the work.',
      disabled: false,
      disableable: false,
    },
    {
      role: 'alpha',
      lifecycle: 'custom',
      source: 'custom' as const,
      summary: 'Alpha role.',
      disabled: false,
      disableable: true,
      scope: 'workspace' as const,
    },
    {
      role: 'beta',
      lifecycle: 'custom',
      source: 'custom' as const,
      summary: 'Beta role.',
      disabled: true,
      disableable: true,
      scope: 'machine' as const,
    },
  ],
  sources: [
    {
      scope: 'workspace' as const,
      workingDir: '/repo',
      machineId: 'machine-1',
      agentCount: 1,
      issues: [],
      updatedAt: 1,
    },
    {
      scope: 'machine' as const,
      machineId: 'machine-1',
      agentCount: 1,
      issues: [{ path: 'beta/AGENT.md', reason: 'missing-frontmatter' as const }],
      updatedAt: 2,
    },
  ],
};

function createDeps(result: unknown) {
  const lines: string[] = [];
  const queries: unknown[] = [];
  return {
    lines,
    queries,
    deps: {
      client: {
        query: async (_endpoint: unknown, args: unknown) => {
          queries.push(args);
          return result;
        },
      },
      sessionId: 'session-1',
      stdout: (line: string) => lines.push(line),
    },
  };
}

describe('listCustomAgents', () => {
  it('prints one line per custom agent with scope, disabled flag, and issue count', async () => {
    const harness = createDeps(roster);

    await listCustomAgents('chatroom-1', harness.deps);

    expect(harness.queries).toEqual([{ sessionId: 'session-1', chatroomId: 'chatroom-1' }]);
    // Builtin roles are not custom agents, so they are not listed.
    expect(harness.lines).not.toContainEqual(expect.stringContaining('planner'));
    expect(harness.lines).toContain('NAME   SCOPE      DISABLED  ISSUES');
    expect(harness.lines).toContain('alpha  workspace  off       0');
    expect(harness.lines).toContain('beta   machine    on        1');
  });

  it('prints the sources with their status and agent counts', async () => {
    const harness = createDeps(roster);

    await listCustomAgents('chatroom-1', harness.deps);

    expect(harness.lines).toContain('SCOPE      LOCATION  STATUS       AGENTS');
    expect(harness.lines).toContain('workspace  /repo     ok           1 agents');
    expect(harness.lines).toContain('machine    machine   with issues  1 agents');
  });

  it('prints every issue with its path, reason, and detail', async () => {
    const harness = createDeps(roster);

    await listCustomAgents('chatroom-1', harness.deps);

    expect(harness.lines).toContain('  machine  beta/AGENT.md  missing-frontmatter');
  });

  it('says so when the chatroom has no custom agents or sources', async () => {
    const harness = createDeps({ roster: [], sources: [] });

    await listCustomAgents('chatroom-1', harness.deps);

    expect(harness.lines).toEqual([
      'Custom agents',
      '  no custom agents',
      '',
      'Sources',
      '  no sources pushed',
      '',
      'Issues',
      '  none',
    ]);
  });

  it('strips control characters from issue text before printing', async () => {
    const harness = createDeps({
      roster: [],
      sources: [
        {
          scope: 'workspace',
          workingDir: '/repo',
          machineId: 'machine-1',
          agentCount: 0,
          issues: [{ path: '\u001b[31mred/AGENT.md', reason: 'missing-frontmatter' }],
          updatedAt: 1,
        },
      ],
    });

    await listCustomAgents('chatroom-1', harness.deps);

    // The whole ANSI sequence goes, not just the ESC: `\u001b[31m` is a colour code.
    expect(harness.lines).toContain('  workspace  red/AGENT.md  missing-frontmatter');
    for (const line of harness.lines) {
      expect(line).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
    }
  });
});
