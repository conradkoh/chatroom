import { describe, expect, it } from 'vitest';

import { hashUnit, normalizeUnit } from './workspace-state-unit.js';
import type { WorkspaceStateUnit } from '../../../infrastructure/outbox/workspace-state-outbox-schema.js';

const CHECK_A = { name: 'build', status: 'completed', conclusion: 'success' };
const CHECK_B = { name: 'lint', status: 'completed', conclusion: 'failure' };
const CHECK_C = { name: 'build', status: 'in_progress', conclusion: null };

// Canonical order: name, then status ('build'/'completed' < 'build'/'in_progress' < 'lint').
const CHECKS_ORDERED: WorkspaceStateUnit = {
  kind: 'checks',
  headCommitStatus: { state: 'failure', totalCount: 3, checkRuns: [CHECK_A, CHECK_C, CHECK_B] },
};
const CHECKS_SHUFFLED: WorkspaceStateUnit = {
  kind: 'checks',
  headCommitStatus: { state: 'failure', totalCount: 3, checkRuns: [CHECK_C, CHECK_B, CHECK_A] },
};

const REMOTE_A = { name: 'origin', url: 'git@github.com:a/b.git' };
const REMOTE_B = { name: 'fork', url: 'git@github.com:c/b.git' };

const PR_1 = {
  prNumber: 1,
  title: 'one',
  url: 'https://example.test/1',
  headRefName: 'one',
  state: 'OPEN',
};
const PR_2 = {
  prNumber: 2,
  title: 'two',
  url: 'https://example.test/2',
  headRefName: 'two',
  state: 'OPEN',
};

const COMMAND_ROOT = { name: 'test', script: 'vitest', source: 'package.json' as const };
const COMMAND_SUB = {
  name: 'test',
  script: 'vitest',
  source: 'package.json' as const,
  subWorkspace: { type: 'npm', path: 'packages/a', name: '@ws/a' },
};
const COMMAND_TURBO = { name: 'build', script: 'turbo build', source: 'turbo.json' as const };

describe('normalizeUnit', () => {
  it('sorts checks by name then status and keeps the status fields', () => {
    const normalized = normalizeUnit(CHECKS_SHUFFLED);
    expect(normalized).toEqual(CHECKS_ORDERED);
  });

  it('sorts remotes by name then url', () => {
    const normalized = normalizeUnit({ kind: 'remotes', remotes: [REMOTE_B, REMOTE_A] });
    // 'fork' < 'origin'
    expect(normalized).toEqual({ kind: 'remotes', remotes: [REMOTE_B, REMOTE_A] });
  });

  it('sorts pull requests by number', () => {
    const normalized = normalizeUnit({ kind: 'pullRequests', openPullRequests: [PR_2, PR_1] });
    expect(normalized).toEqual({ kind: 'pullRequests', openPullRequests: [PR_1, PR_2] });
  });

  it('sorts commands by source, then sub-workspace path, then name', () => {
    const normalized = normalizeUnit({
      kind: 'commands',
      commands: [COMMAND_TURBO, COMMAND_SUB, COMMAND_ROOT],
    });
    // 'package.json' < 'turbo.json'; within package.json the root ('' path) precedes 'packages/a'.
    expect(normalized).toEqual({
      kind: 'commands',
      commands: [COMMAND_ROOT, COMMAND_SUB, COMMAND_TURBO],
    });
  });

  it('does not mutate its input', () => {
    const input: WorkspaceStateUnit = { kind: 'remotes', remotes: [REMOTE_B, REMOTE_A] };
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeUnit(input);
    expect(input).toEqual(snapshot);
  });

  it('passes null checks through unchanged', () => {
    expect(normalizeUnit({ kind: 'checks', headCommitStatus: null })).toEqual({
      kind: 'checks',
      headCommitStatus: null,
    });
  });
});

describe('hashUnit', () => {
  it('is equal for checks inputs that differ only in array order', () => {
    expect(hashUnit(CHECKS_SHUFFLED)).toBe(hashUnit(CHECKS_ORDERED));
  });

  it('is equal for remotes and pull requests that differ only in array order', () => {
    expect(hashUnit({ kind: 'remotes', remotes: [REMOTE_A, REMOTE_B] })).toBe(
      hashUnit({ kind: 'remotes', remotes: [REMOTE_B, REMOTE_A] })
    );
    expect(hashUnit({ kind: 'pullRequests', openPullRequests: [PR_1, PR_2] })).toBe(
      hashUnit({ kind: 'pullRequests', openPullRequests: [PR_2, PR_1] })
    );
  });

  it('is equal for commands that differ only in array order', () => {
    expect(
      hashUnit({ kind: 'commands', commands: [COMMAND_ROOT, COMMAND_SUB, COMMAND_TURBO] })
    ).toBe(hashUnit({ kind: 'commands', commands: [COMMAND_TURBO, COMMAND_SUB, COMMAND_ROOT] }));
  });

  it('changes when a presentation field changes', () => {
    const base = hashUnit(CHECKS_ORDERED);
    const stateChanged = hashUnit({
      kind: 'checks',
      headCommitStatus: { ...CHECKS_ORDERED.headCommitStatus!, state: 'success' },
    });
    const conclusionChanged = hashUnit({
      kind: 'checks',
      headCommitStatus: {
        ...CHECKS_ORDERED.headCommitStatus!,
        checkRuns: [CHECK_A, { ...CHECK_B, conclusion: 'success' }, CHECK_C],
      },
    });
    expect(stateChanged).not.toBe(base);
    expect(conclusionChanged).not.toBe(base);

    const urlChanged = hashUnit({
      kind: 'remotes',
      remotes: [REMOTE_A, { ...REMOTE_B, url: 'https://elsewhere.test/b.git' }],
    });
    expect(urlChanged).not.toBe(hashUnit({ kind: 'remotes', remotes: [REMOTE_A, REMOTE_B] }));
  });

  it('returns a 40-character sha1 hex digest', () => {
    expect(hashUnit({ kind: 'upstream', commitsAhead: 1, commitsBehind: 0 })).toMatch(
      /^[0-9a-f]{40}$/
    );
  });
});
