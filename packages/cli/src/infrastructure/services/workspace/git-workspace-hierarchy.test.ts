import { mkdtempSync, realpathSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runGit } from '../../git/run-command.js';
import { discoverGitWorkspaceHierarchy } from './git-workspace-hierarchy.js';

async function git(...args: string[]): Promise<void> {
  const result = await runGit(args, tmpDir);
  if ('error' in result) throw new Error(`git ${args.join(' ')}: ${result.error.message}`);
}

let tmpDir: string;

describe('discoverGitWorkspaceHierarchy', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tmp-hierarchy-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function gitIn(cwd: string, ...args: string[]): Promise<void> {
    const result = await runGit(args, cwd);
    if ('error' in result) throw new Error(`git ${args.join(' ')}: ${result.error.message}`);
  }

  it('returns null for a non-git directory', async () => {
    const result = await discoverGitWorkspaceHierarchy(tmpDir);
    expect(result).toBeNull();
  });

  it('returns hierarchy for a simple repo at workspace root', async () => {
    await git('init');
    await git('config', 'user.email', 'test@test.com');
    await git('config', 'user.name', 'Test');
    await writeFile(path.join(tmpDir, 'README.md'), 'hello');
    await git('add', '-A');
    await git('commit', '-m', 'init');

    const result = await discoverGitWorkspaceHierarchy(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.root.relativePath).toBe('');
    expect(result!.root.pathspec).toEqual([]);
    expect(result!.root.children).toEqual([]);
  });

  it('returns pathspec when workspace is a subdirectory of a larger repo', async () => {
    await git('init');
    await git('config', 'user.email', 'test@test.com');
    await git('config', 'user.name', 'Test');
    await writeFile(path.join(tmpDir, 'README.md'), 'hello');
    await git('add', '-A');
    await git('commit', '-m', 'init');

    const subDir = path.join(tmpDir, 'apps', 'web');
    await mkdir(subDir, { recursive: true });
    const subDirReal = realpathSync(subDir);

    const result = await discoverGitWorkspaceHierarchy(subDirReal);
    expect(result).not.toBeNull();
    expect(result!.workspaceRoot).toBe(subDirReal);
    expect(result!.root.workTree).toBe(realpathSync(tmpDir));
    expect(result!.root.relativePath).toBe('');
    expect(result!.root.pathspec).toEqual(['apps/web']);
  });

  it('discovers a nested .git directory', async () => {
    await git('init');
    await git('config', 'user.email', 'test@test.com');
    await git('config', 'user.name', 'Test');
    await writeFile(path.join(tmpDir, 'README.md'), 'hello');
    await git('add', '-A');
    await git('commit', '-m', 'init');

    const nestedDir = path.join(tmpDir, 'packages', 'lib');
    await mkdir(nestedDir, { recursive: true });
    await gitIn(nestedDir, 'init');
    await gitIn(nestedDir, 'config', 'user.email', 'test@test.com');
    await gitIn(nestedDir, 'config', 'user.name', 'Test');
    await writeFile(path.join(nestedDir, 'index.ts'), '// lib');
    await gitIn(nestedDir, 'add', '-A');
    await gitIn(nestedDir, 'commit', '-m', 'init nested');

    const result = await discoverGitWorkspaceHierarchy(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.root.children).toHaveLength(1);
    expect(result!.root.children[0]!.workTree).toBe(realpathSync(nestedDir));
    expect(result!.root.children[0]!.relativePath).toBe('packages/lib');
    expect(result!.root.children[0]!.pathspec).toEqual([]);
  });

  it('discovers a nested .git file (submodule checkout)', async () => {
    await git('init');
    await git('config', 'user.email', 'test@test.com');
    await git('config', 'user.name', 'Test');
    await writeFile(path.join(tmpDir, 'README.md'), 'hello');
    await git('add', '-A');
    await git('commit', '-m', 'init');

    const subDir = path.join(tmpDir, 'vendor', 'sublib');
    await mkdir(subDir, { recursive: true });
    await writeFile(path.join(subDir, 'file.txt'), 'content');

    const gitModulesDir = path.join(tmpDir, '.git', 'modules', 'vendor', 'sublib');
    await mkdir(gitModulesDir, { recursive: true });
    await gitIn(gitModulesDir, 'init', '--bare');

    await writeFile(path.join(subDir, '.git'), `gitdir: ${gitModulesDir}\n`);

    const result = await discoverGitWorkspaceHierarchy(tmpDir);
    expect(result).not.toBeNull();
    const children = result!.root.children;
    const subDirReal = realpathSync(subDir);
    const subChild = children.find((c) => c.workTree === subDirReal);
    expect(subChild).toBeDefined();
    expect(subChild!.relativePath).toBe('vendor/sublib');
    expect(subChild!.gitDir).toBe(realpathSync(gitModulesDir));
  });

  it('parenting: nested-inside-nested attaches under correct ancestor', async () => {
    await git('init');
    await git('config', 'user.email', 'test@test.com');
    await git('config', 'user.name', 'Test');
    await writeFile(path.join(tmpDir, 'README.md'), 'hello');
    await git('add', '-A');
    await git('commit', '-m', 'init');

    const nestedA = path.join(tmpDir, 'a');
    await mkdir(nestedA, { recursive: true });
    await gitIn(nestedA, 'init');
    await gitIn(nestedA, 'config', 'user.email', 'test@test.com');
    await gitIn(nestedA, 'config', 'user.name', 'Test');
    await writeFile(path.join(nestedA, 'f.txt'), 'a');
    await gitIn(nestedA, 'add', '-A');
    await gitIn(nestedA, 'commit', '-m', 'a');

    const nestedB = path.join(tmpDir, 'a', 'b');
    await mkdir(nestedB, { recursive: true });
    await gitIn(nestedB, 'init');
    await gitIn(nestedB, 'config', 'user.email', 'test@test.com');
    await gitIn(nestedB, 'config', 'user.name', 'Test');
    await writeFile(path.join(nestedB, 'g.txt'), 'b');
    await gitIn(nestedB, 'add', '-A');
    await gitIn(nestedB, 'commit', '-m', 'b');

    const result = await discoverGitWorkspaceHierarchy(tmpDir);
    expect(result).not.toBeNull();
    const nestedAReal = realpathSync(nestedA);
    const nestedBReal = realpathSync(nestedB);

    const childA = result!.root.children.find((c) => c.workTree === nestedAReal);
    expect(childA).toBeDefined();
    expect(childA!.children).toHaveLength(1);
    expect(childA!.children[0]!.workTree).toBe(nestedBReal);
  });
});
