import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cloneRepositoryIfNeeded } from './clone-repository.js';
import { runGit } from './run-command.js';

vi.mock('./run-command.js', () => ({
  runGit: vi.fn(),
}));

const mockedRunGit = vi.mocked(runGit);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  mockedRunGit.mockReset();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chatroom-clone-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('cloneRepositoryIfNeeded', () => {
  it('clones into a missing target directory', async () => {
    const root = await createTemporaryDirectory();
    mockedRunGit.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await cloneRepositoryIfNeeded(
      'https://github.com/acme/widget.git',
      path.join(root, 'repos', 'widget')
    );

    expect(result).toEqual({
      success: true,
      workingDir: path.join(root, 'repos', 'widget'),
      cloned: true,
    });
    expect(mockedRunGit).toHaveBeenCalledWith(
      ['clone', 'https://github.com/acme/widget.git', 'widget'],
      path.join(root, 'repos'),
      { timeout: 5 * 60_000 }
    );
  });

  it('reuses an existing git repository without cloning', async () => {
    const root = await createTemporaryDirectory();
    const target = path.join(root, 'widget');
    await mkdir(target);
    mockedRunGit.mockResolvedValue({ stdout: '.git\n', stderr: '' });

    await expect(
      cloneRepositoryIfNeeded('https://github.com/acme/widget.git', target)
    ).resolves.toEqual({
      success: true,
      workingDir: target,
      cloned: false,
    });
    expect(mockedRunGit).toHaveBeenCalledWith(['rev-parse', '--git-dir'], target, {
      readOnly: true,
    });
  });

  it('fails when an existing target is not a git repository', async () => {
    const root = await createTemporaryDirectory();
    const target = path.join(root, 'widget');
    await mkdir(target);
    mockedRunGit.mockResolvedValue({ error: new Error('not a repository') });

    await expect(
      cloneRepositoryIfNeeded('https://github.com/acme/widget.git', target)
    ).resolves.toEqual({
      success: false,
      error: 'Folder already exists and is not a git repository',
    });
  });
});
