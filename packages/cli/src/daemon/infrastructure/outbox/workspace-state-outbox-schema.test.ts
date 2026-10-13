import { describe, expect, it } from 'vitest';

import {
  workspaceStateUnitSchema,
  type WorkspaceStateUnit,
} from './workspace-state-outbox-schema.js';

const DIFF_STAT = { filesChanged: 1, insertions: 2, deletions: 3 };

const VALID_UNITS: WorkspaceStateUnit[] = [
  { kind: 'head', status: 'available', branch: 'main' },
  { kind: 'head', status: 'not_found' },
  { kind: 'head', status: 'error', errorMessage: 'detached' },
  { kind: 'worktree', isDirty: true, diffStat: DIFF_STAT },
  { kind: 'upstream', commitsAhead: 1, commitsBehind: 0 },
  { kind: 'remotes', remotes: [{ name: 'origin', url: 'git@github.com:a/b.git' }] },
  {
    kind: 'pullRequests',
    openPullRequests: [
      { prNumber: 7, title: 't', url: 'https://example.test/7', headRefName: 'b', state: 'OPEN' },
    ],
  },
  {
    kind: 'checks',
    headCommitStatus: {
      state: 'success',
      checkRuns: [{ name: 'ci', status: 'completed', conclusion: null }],
      totalCount: 1,
    },
  },
  { kind: 'checks', headCommitStatus: null },
  {
    kind: 'recentCommits',
    commits: [{ sha: 'a'.repeat(40), shortSha: 'aaaaaaa', message: 'm', author: 'me', date: 'd' }],
    hasMoreCommits: false,
  },
  {
    kind: 'commands',
    commands: [
      { name: 'build', script: 'tsc', source: 'package.json' },
      {
        name: 'test',
        script: 'vitest',
        source: 'turbo.json',
        subWorkspace: { type: 'package', path: 'packages/cli', name: 'cli' },
      },
    ],
  },
];

describe('workspaceStateUnitSchema', () => {
  it.each(VALID_UNITS.map((unit) => [unit.kind, unit] as const))(
    'accepts a %s unit and round-trips it through JSON',
    (_kind, unit) => {
      const parsed = workspaceStateUnitSchema.parse(JSON.parse(JSON.stringify(unit)));
      expect(parsed).toEqual(unit);
    }
  );

  it('accepts an optional commit body when present and absent', () => {
    const base = { sha: 'a', shortSha: 'a', message: 'm', author: 'me', date: 'd' };
    expect(() =>
      workspaceStateUnitSchema.parse({
        kind: 'recentCommits',
        commits: [{ ...base, body: 'details' }, base],
        hasMoreCommits: true,
      })
    ).not.toThrow();
  });

  it.each([
    [
      'an unknown field on a git unit',
      { kind: 'upstream', commitsAhead: 1, commitsBehind: 0, x: 1 },
    ],
    ['an unknown field on a head variant', { kind: 'head', status: 'not_found', branch: 'main' }],
    ['a head available unit without a branch', { kind: 'head', status: 'available' }],
    ['an unknown kind', { kind: 'bogus' }],
    [
      'a command source outside the allowed list',
      { kind: 'commands', commands: [{ name: 'a', script: 'b', source: 'pom.xml' }] },
    ],
    [
      'a check run with a non-string conclusion',
      {
        kind: 'checks',
        headCommitStatus: {
          state: 's',
          checkRuns: [{ name: 'n', status: 's', conclusion: 1 }],
          totalCount: 1,
        },
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(workspaceStateUnitSchema.safeParse(value).success).toBe(false);
  });
});
