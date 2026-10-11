/**
 * local-unit-collector Unit Tests
 *
 * Mocks the git readers for the unit-shape and gating cases. The last case runs the real readers
 * against a temp repository, so the wiring to git itself is covered.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { collectLocalUnits } from './local-unit-collector.js';
import * as commandDiscovery from '../../../../infrastructure/services/workspace/command-discovery.js';
import * as gitReader from '../../../infrastructure/git/git-reader.js';
import { COMMITS_PER_PAGE, type GitCommit } from '../../../infrastructure/git/types.js';
import type { LocalKind } from '../domain/workspace-state-unit.js';

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  isGitRepo: vi.fn(),
  getBranch: vi.fn(),
  isDirty: vi.fn(),
  getDiffStat: vi.fn(),
  getCommitsAhead: vi.fn(),
  getCommitsBehind: vi.fn(),
  getRemotes: vi.fn(),
  getRecentCommits: vi.fn(),
}));

vi.mock('../../../../infrastructure/services/workspace/command-discovery.js', () => ({
  discoverCommands: vi.fn(),
}));

const WORKING_DIR = '/repo';

function kinds(...items: LocalKind[]): ReadonlySet<LocalKind> {
  return new Set(items);
}

function commit(overrides: Partial<GitCommit> = {}): GitCommit {
  return {
    sha: 'a'.repeat(40),
    shortSha: 'aaaaaaa',
    message: 'subject',
    author: 'Ada',
    date: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function makeCommits(count: number): GitCommit[] {
  return Array.from({ length: count }, (_, i) => commit({ sha: String(i).padStart(40, '0') }));
}

/** Default: a clean repo on `main` with no remotes, no upstream, no commits, no commands. */
function setDefaultReaders(): void {
  vi.mocked(gitReader.isGitRepo).mockResolvedValue(true);
  vi.mocked(gitReader.getBranch).mockResolvedValue({ status: 'available', branch: 'main' });
  vi.mocked(gitReader.isDirty).mockResolvedValue(false);
  vi.mocked(gitReader.getDiffStat).mockResolvedValue({
    status: 'available',
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
  });
  vi.mocked(gitReader.getCommitsAhead).mockResolvedValue(0);
  vi.mocked(gitReader.getCommitsBehind).mockResolvedValue(0);
  vi.mocked(gitReader.getRemotes).mockResolvedValue([]);
  vi.mocked(gitReader.getRecentCommits).mockResolvedValue([]);
  vi.mocked(commandDiscovery.discoverCommands).mockResolvedValue([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  setDefaultReaders();
});

describe('collectLocalUnits with mocked readers', () => {
  test('not a git repo: only a not_found head unit, and no other git reads', async () => {
    vi.mocked(gitReader.isGitRepo).mockResolvedValue(false);

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'worktree', 'remotes'));

    expect(result).toEqual({
      units: [{ kind: 'head', status: 'not_found' }],
      headAvailable: false,
      branch: null,
      hasRemote: false,
    });
    expect(gitReader.getRemotes).not.toHaveBeenCalled();
    expect(gitReader.isDirty).not.toHaveBeenCalled();
  });

  test('not a git repo with commands requested: head not_found plus the commands unit', async () => {
    vi.mocked(gitReader.isGitRepo).mockResolvedValue(false);
    vi.mocked(commandDiscovery.discoverCommands).mockResolvedValue([
      {
        name: 'npm: build',
        script: 'npm run build',
        source: 'package.json',
        subWorkspace: { type: 'npm', path: '.', name: 'root' },
      },
    ]);

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'commands'));

    expect(result.units).toEqual([
      { kind: 'head', status: 'not_found' },
      {
        kind: 'commands',
        commands: [
          {
            name: 'npm: build',
            script: 'npm run build',
            source: 'package.json',
            subWorkspace: { type: 'npm', path: '.', name: 'root' },
          },
        ],
      },
    ]);
    expect(result.headAvailable).toBe(false);
  });

  test('getBranch error: head error unit carries the message and head is unavailable', async () => {
    vi.mocked(gitReader.getBranch).mockResolvedValue({
      status: 'error',
      message: 'permission denied',
    });

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'worktree', 'remotes'));

    expect(result).toEqual({
      units: [{ kind: 'head', status: 'error', errorMessage: 'permission denied' }],
      headAvailable: false,
      branch: null,
      hasRemote: false,
    });
    expect(gitReader.getRemotes).not.toHaveBeenCalled();
  });

  test('getBranch not_found: no head unit, head is unavailable, and commands still emitted', async () => {
    vi.mocked(gitReader.getBranch).mockResolvedValue({ status: 'not_found' });
    vi.mocked(commandDiscovery.discoverCommands).mockResolvedValue([]);

    const withoutCommands = await collectLocalUnits(WORKING_DIR, kinds('head'));
    expect(withoutCommands).toEqual({
      units: [],
      headAvailable: false,
      branch: null,
      hasRemote: false,
    });

    const withCommands = await collectLocalUnits(WORKING_DIR, kinds('head', 'commands'));
    expect(withCommands.units).toEqual([{ kind: 'commands', commands: [] }]);
  });

  test('head available with only head requested: head unit only, and hasRemote is still computed', async () => {
    vi.mocked(gitReader.getRemotes).mockResolvedValue([
      { name: 'origin', url: 'https://github.com/acme/repo.git' },
    ]);

    const result = await collectLocalUnits(WORKING_DIR, kinds('head'));

    expect(result).toEqual({
      units: [{ kind: 'head', status: 'available', branch: 'main' }],
      headAvailable: true,
      branch: 'main',
      hasRemote: true,
    });
    expect(gitReader.getRemotes).toHaveBeenCalledWith(WORKING_DIR);
  });

  test('worktree requested: carries the dirty flag and the mocked diff stat', async () => {
    vi.mocked(gitReader.isDirty).mockResolvedValue(true);
    vi.mocked(gitReader.getDiffStat).mockResolvedValue({
      status: 'available',
      diffStat: { filesChanged: 3, insertions: 45, deletions: 12 },
    });

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'worktree'));

    expect(result.units).toContainEqual({
      kind: 'worktree',
      isDirty: true,
      diffStat: { filesChanged: 3, insertions: 45, deletions: 12 },
    });
  });

  test('worktree with a non-available diff stat: zeros, not an error', async () => {
    vi.mocked(gitReader.getDiffStat).mockResolvedValue({ status: 'no_commits' });

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'worktree'));

    expect(result.units).toContainEqual({
      kind: 'worktree',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    });
  });

  test('upstream requested: carries ahead and behind counts', async () => {
    vi.mocked(gitReader.getCommitsAhead).mockResolvedValue(2);
    vi.mocked(gitReader.getCommitsBehind).mockResolvedValue(5);

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'upstream'));

    expect(result.units).toContainEqual({ kind: 'upstream', commitsAhead: 2, commitsBehind: 5 });
  });

  test('remotes requested: emits the remotes unit with name and url only', async () => {
    vi.mocked(gitReader.getRemotes).mockResolvedValue([
      { name: 'origin', url: 'https://github.com/acme/repo.git' },
      { name: 'upstream', url: 'https://github.com/other/repo.git' },
    ]);

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'remotes'));

    expect(result.units).toContainEqual({
      kind: 'remotes',
      remotes: [
        { name: 'origin', url: 'https://github.com/acme/repo.git' },
        { name: 'upstream', url: 'https://github.com/other/repo.git' },
      ],
    });
    expect(result.hasRemote).toBe(true);
  });

  test('remotes requested but head unavailable: no remotes unit', async () => {
    vi.mocked(gitReader.getBranch).mockResolvedValue({ status: 'not_found' });

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'remotes', 'upstream'));

    expect(result.units.some((unit) => unit.kind === 'remotes')).toBe(false);
    expect(result.units.some((unit) => unit.kind === 'upstream')).toBe(false);
  });

  test('recentCommits with exactly COMMITS_PER_PAGE commits: hasMoreCommits is true', async () => {
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue(makeCommits(COMMITS_PER_PAGE));

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'recentCommits'));

    const unit = result.units.find((u) => u.kind === 'recentCommits');
    expect(unit).toBeDefined();
    expect(unit).toMatchObject({ kind: 'recentCommits', hasMoreCommits: true });
    expect(gitReader.getRecentCommits).toHaveBeenCalledWith(WORKING_DIR, COMMITS_PER_PAGE);
  });

  test('recentCommits with one fewer than COMMITS_PER_PAGE: hasMoreCommits is false', async () => {
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue(makeCommits(COMMITS_PER_PAGE - 1));

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'recentCommits'));

    expect(result.units).toContainEqual(
      expect.objectContaining({ kind: 'recentCommits', hasMoreCommits: false })
    );
  });

  test('recentCommits maps only wire fields and omits body when the commit has none', async () => {
    vi.mocked(gitReader.getRecentCommits).mockResolvedValue([
      commit({ sha: 'b'.repeat(40), shortSha: 'bbbbbbb', body: 'details' }),
      commit({ sha: 'c'.repeat(40), shortSha: 'ccccccc' }),
    ]);

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'recentCommits'));

    // toStrictEqual, not toEqual: an explicit `body: undefined` key must fail this test.
    const unit = result.units.find((u) => u.kind === 'recentCommits');
    expect(unit).toStrictEqual({
      kind: 'recentCommits',
      hasMoreCommits: false,
      commits: [
        {
          sha: 'b'.repeat(40),
          shortSha: 'bbbbbbb',
          message: 'subject',
          body: 'details',
          author: 'Ada',
          date: '2026-10-01T00:00:00Z',
        },
        {
          sha: 'c'.repeat(40),
          shortSha: 'ccccccc',
          message: 'subject',
          author: 'Ada',
          date: '2026-10-01T00:00:00Z',
        },
      ],
    });
  });

  test('commands requested with head available: emits the commands unit', async () => {
    vi.mocked(commandDiscovery.discoverCommands).mockResolvedValue([
      {
        name: 'pnpm: test',
        script: 'pnpm run test',
        source: 'package.json',
        subWorkspace: { type: 'npm', path: 'packages/cli', name: '@acme/cli' },
      },
    ]);

    const result = await collectLocalUnits(WORKING_DIR, kinds('head', 'commands'));

    expect(result.units).toContainEqual({
      kind: 'commands',
      commands: [
        {
          name: 'pnpm: test',
          script: 'pnpm run test',
          source: 'package.json',
          subWorkspace: { type: 'npm', path: 'packages/cli', name: '@acme/cli' },
        },
      ],
    });
    expect(commandDiscovery.discoverCommands).toHaveBeenCalledWith(WORKING_DIR);
  });

  test('commands not requested: discoverCommands is not called', async () => {
    await collectLocalUnits(WORKING_DIR, kinds('head', 'worktree'));

    expect(commandDiscovery.discoverCommands).not.toHaveBeenCalled();
  });
});

describe('collectLocalUnits on a real git repository', () => {
  let dir: string;

  beforeEach(async () => {
    // Route the mocked readers back to the real implementations for this suite only.
    const actual = await vi.importActual<typeof gitReader>(
      '../../../infrastructure/git/git-reader.js'
    );
    vi.mocked(gitReader.isGitRepo).mockImplementation(actual.isGitRepo);
    vi.mocked(gitReader.getBranch).mockImplementation(actual.getBranch);
    vi.mocked(gitReader.isDirty).mockImplementation(actual.isDirty);
    vi.mocked(gitReader.getDiffStat).mockImplementation(actual.getDiffStat);
    vi.mocked(gitReader.getRemotes).mockImplementation(actual.getRemotes);

    dir = mkdtempSync(path.join(os.tmpdir(), 'local-unit-collector-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    git('add', 'a.txt');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'init'
    );
    // Modify the tracked file so the worktree is dirty with one inserted line.
    writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('head and worktree units match the real repository state', async () => {
    const result = await collectLocalUnits(dir, kinds('head', 'worktree'));

    expect(result).toEqual({
      units: [
        { kind: 'head', status: 'available', branch: 'main' },
        {
          kind: 'worktree',
          isDirty: true,
          diffStat: { filesChanged: 1, insertions: 1, deletions: 0 },
        },
      ],
      headAvailable: true,
      branch: 'main',
      hasRemote: false,
    });
  });
});
