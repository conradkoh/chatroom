import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runGitClone, type GitCloneProgress, type RunGitCloneOptions } from './git-clone.js';

const REPO_URL = 'https://github.com/acme/my-repo.git';

let workDir: string;
let cloneCount = 0;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'git-clone-test-'));
  cloneCount = 0;
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A fresh target path under the temp dir that does not exist yet. */
function freshTarget(): string {
  cloneCount += 1;
  return join(workDir, `clone-${cloneCount}`);
}

// ---------------------------------------------------------------------------
// Fake git child process
// ---------------------------------------------------------------------------

type FakeChild = EventEmitter & { stderr: PassThrough; kill: ReturnType<typeof vi.fn> };

/** Fake ChildProcess. `script` runs on the next microtask, after the runner has attached listeners. */
function fakeChild(script: (child: FakeChild) => void): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  queueMicrotask(() => script(child));
  return child;
}

type SpawnFn = NonNullable<RunGitCloneOptions['spawnFn']>;

function asSpawn(fn: () => FakeChild): SpawnFn {
  return fn as unknown as SpawnFn;
}

/** Runs the clone against a fake git that writes `stderr` and exits with `exitCode`. */
async function cloneWithFakeGit(stderr: string, exitCode: number) {
  const progress: GitCloneProgress[] = [];
  const outcome = await runGitClone({
    repoUrl: REPO_URL,
    targetPath: freshTarget(),
    onProgress: (p) => progress.push(p),
    spawnFn: asSpawn(() =>
      fakeChild((child) => {
        child.stderr.write(stderr);
        // PassThrough delivers data asynchronously, so close after the data has been read.
        setImmediate(() => child.emit('close', exitCode));
      })
    ),
  });
  return { outcome, progress };
}

// ---------------------------------------------------------------------------
// Progress parsing (observed through onProgress)
// ---------------------------------------------------------------------------

describe('progress parsing', () => {
  it('parses known phases, including the remote: prefix, and clamps percent to 100', async () => {
    const { progress } = await cloneWithFakeGit(
      [
        'Receiving objects:  42% (420/1000)',
        'remote: Counting objects: 100% (3/3), done.',
        'Resolving deltas:   7% (1/14)',
        'Compressing objects:  50% (5/10)',
        'Updating files:  99% (9/9)',
        'Receiving objects: 150% (1/1)',
      ].join('\n') + '\n',
      0
    );

    expect(progress).toEqual([
      { phase: 'Receiving objects', percent: 42 },
      { phase: 'Counting objects', percent: 100 },
      { phase: 'Resolving deltas', percent: 7 },
      { phase: 'Compressing objects', percent: 50 },
      { phase: 'Updating files', percent: 99 },
      { phase: 'Receiving objects', percent: 100 },
    ]);
  });

  it('ignores lines that are not progress updates', async () => {
    const { progress } = await cloneWithFakeGit(
      [
        "Cloning into 'my-repo'...",
        'Note: switching to a branch 5%',
        'remote: Enumerating objects: 5, done.',
        '',
      ].join('\n'),
      0
    );

    expect(progress).toEqual([]);
  });

  it('joins a progress line split across chunks and accepts \\r separators', async () => {
    const progress: GitCloneProgress[] = [];
    await runGitClone({
      repoUrl: REPO_URL,
      targetPath: freshTarget(),
      onProgress: (p) => progress.push(p),
      spawnFn: asSpawn(() =>
        fakeChild((child) => {
          child.stderr.write('Receiving obj');
          child.stderr.write('ects:  42% (4/10)\rremote: Counting objects: 100% (3/3), done.\n');
          setImmediate(() => child.emit('close', 0));
        })
      ),
    });

    expect(progress).toEqual([
      { phase: 'Receiving objects', percent: 42 },
      { phase: 'Counting objects', percent: 100 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Failure classification (observed through the outcome)
// ---------------------------------------------------------------------------

describe('failure classification', () => {
  it.each([
    [
      'target_not_empty',
      "fatal: destination path 'x' already exists and is not an empty directory.",
    ],
    ['auth', "fatal: could not read Username for 'https://github.com': terminal prompts disabled"],
    ['auth', 'git@github.com: Permission denied (publickey).'],
    ['auth', 'Host key verification failed.'],
    ['repo_not_found', 'remote: Repository not found.\nfatal: repository not found'],
    ['repo_not_found', "fatal: 'x' does not appear to be a git repository"],
    ['network', 'ssh: Could not resolve host: example.invalid'],
    ['network', "fatal: unable to access 'https://x/': Failed to connect"],
    ['network', 'Connection timed out'],
    ['unknown', 'something completely unexpected'],
  ] as const)('classifies %j as %s', async (expected, stderr) => {
    const { outcome } = await cloneWithFakeGit(stderr, 128);
    expect(outcome).toMatchObject({ ok: false, errorCode: expected });
  });

  it('classifies a missing git binary (ENOENT) as git_missing with the shared message', async () => {
    const outcome = await runGitClone({
      repoUrl: REPO_URL,
      targetPath: freshTarget(),
      onProgress: () => {},
      spawnFn: asSpawn(() =>
        fakeChild((child) => {
          child.emit('error', Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
        })
      ),
    });

    expect(outcome).toEqual({
      ok: false,
      errorCode: 'git_missing',
      errorMessage: expect.stringContaining('git is not installed'),
    });
  });

  it('classifies other spawn errors as unknown', async () => {
    const outcome = await runGitClone({
      repoUrl: REPO_URL,
      targetPath: freshTarget(),
      onProgress: () => {},
      spawnFn: asSpawn(() =>
        fakeChild((child) => {
          child.emit('error', Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }));
        })
      ),
    });

    expect(outcome).toMatchObject({ ok: false, errorCode: 'unknown' });
  });

  it('redacts URL credentials from the error message and keeps the reason', async () => {
    const { outcome } = await cloneWithFakeGit(
      "fatal: unable to access 'https://user:s3cret@github.com/acme/my-repo.git/': Authentication failed\n",
      128
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errorCode).toBe('auth');
    expect(outcome.errorMessage).toContain('Authentication failed');
    expect(outcome.errorMessage).not.toContain('s3cret');
  });

  it('falls back to the shared message when git exits non-zero with no stderr', async () => {
    const outcome = await runGitClone({
      repoUrl: REPO_URL,
      targetPath: freshTarget(),
      onProgress: () => {},
      spawnFn: asSpawn(() => fakeChild((child) => child.emit('close', 1))),
    });

    expect(outcome).toEqual({ ok: false, errorCode: 'unknown', errorMessage: 'The clone failed.' });
  });
});

// ---------------------------------------------------------------------------
// Target preflight
// ---------------------------------------------------------------------------

describe('target preflight', () => {
  it('starts the clone when the target does not exist', async () => {
    const spawnFn = vi.fn(() => fakeChild((child) => setImmediate(() => child.emit('close', 0))));
    const outcome = await runGitClone({
      repoUrl: REPO_URL,
      targetPath: join(workDir, 'missing'),
      onProgress: () => {},
      spawnFn: spawnFn as unknown as SpawnFn,
    });

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
  });

  it('starts the clone when the target is an empty directory', async () => {
    const empty = join(workDir, 'empty');
    mkdirSync(empty);
    const spawnFn = vi.fn(() => fakeChild((child) => setImmediate(() => child.emit('close', 0))));

    const outcome = await runGitClone({
      repoUrl: REPO_URL,
      targetPath: empty,
      onProgress: () => {},
      spawnFn: spawnFn as unknown as SpawnFn,
    });

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
  });

  it('refuses a non-empty directory without spawning git', async () => {
    const full = join(workDir, 'occupied');
    mkdirSync(full);
    writeFileSync(join(full, 'file.txt'), 'x');
    const spawnFn = vi.fn();

    const outcome = await runGitClone({
      repoUrl: REPO_URL,
      targetPath: full,
      onProgress: () => {},
      spawnFn: spawnFn as unknown as SpawnFn,
    });

    expect(outcome).toMatchObject({ ok: false, errorCode: 'target_not_empty' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('refuses a target that is a file without spawning git', async () => {
    const file = join(workDir, 'a-file');
    writeFileSync(file, 'x');
    const spawnFn = vi.fn();

    const outcome = await runGitClone({
      repoUrl: REPO_URL,
      targetPath: file,
      onProgress: () => {},
      spawnFn: spawnFn as unknown as SpawnFn,
    });

    expect(outcome).toMatchObject({ ok: false, errorCode: 'target_not_empty' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('never deletes an existing target on failure', async () => {
    const full = join(workDir, 'keep-me');
    mkdirSync(full);
    writeFileSync(join(full, 'file.txt'), 'x');

    await runGitClone({
      repoUrl: REPO_URL,
      targetPath: full,
      onProgress: () => {},
      spawnFn: asSpawn(() => fakeChild(() => {})),
    });

    expect(existsSync(join(full, 'file.txt'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Input validation, timeout, and the real clone
// ---------------------------------------------------------------------------

describe('runGitClone', () => {
  it('rejects an invalid URL without spawning git', async () => {
    const spawnFn = vi.fn();
    const outcome = await runGitClone({
      repoUrl: 'ext::sh -c touch% /tmp/pwned',
      targetPath: freshTarget(),
      onProgress: () => {},
      spawnFn: spawnFn as unknown as SpawnFn,
    });

    expect(outcome).toMatchObject({ ok: false, errorCode: 'invalid_request' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('rejects a filesystem-root target without spawning git', async () => {
    const spawnFn = vi.fn();
    const outcome = await runGitClone({
      repoUrl: REPO_URL,
      targetPath: '/',
      onProgress: () => {},
      spawnFn: spawnFn as unknown as SpawnFn,
    });

    expect(outcome).toMatchObject({ ok: false, errorCode: 'invalid_request' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('kills the clone with SIGTERM and returns timeout when it runs too long', async () => {
    let spawned: FakeChild | undefined;
    const outcome = await runGitClone({
      repoUrl: REPO_URL,
      targetPath: freshTarget(),
      onProgress: () => {},
      timeoutMs: 5,
      spawnFn: asSpawn(() => {
        spawned = fakeChild(() => {});
        return spawned;
      }),
    });

    expect(outcome).toMatchObject({ ok: false, errorCode: 'timeout' });
    expect(spawned?.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('clones a local bare repository through the ssh transport and reports the target', async () => {
    const origin = join(workDir, 'origin.git');
    const seed = join(workDir, 'seed');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    mkdirSync(seed);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: seed });
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'],
      { cwd: seed }
    );
    execFileSync('git', ['push', '-q', origin, 'HEAD:refs/heads/main'], { cwd: seed });

    // Fake ssh: git runs `$GIT_SSH_COMMAND [opts] host "git-upload-pack '<path>'"`.
    // This runs that remote command locally, so the real ssh transport, the production URL
    // validator, and the GIT_ALLOW_PROTOCOL default are all exercised.
    const fakeSsh = join(workDir, 'fake-ssh.sh');
    writeFileSync(fakeSsh, '#!/bin/sh\nfor last; do :; done\nexec sh -c "git ${last#git-}"\n');
    chmodSync(fakeSsh, 0o755);
    const previous = process.env.GIT_SSH_COMMAND;
    process.env.GIT_SSH_COMMAND = fakeSsh;
    try {
      const target = join(workDir, 'clone-target');
      const outcome = await runGitClone({
        repoUrl: `git@localhost:${origin}`,
        targetPath: `${target}/`,
        onProgress: () => {},
      });

      expect(outcome).toEqual({ ok: true, clonedPath: target });
      expect(existsSync(join(target, '.git'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.GIT_SSH_COMMAND;
      else process.env.GIT_SSH_COMMAND = previous;
    }
  });
});
