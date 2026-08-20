import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isPathIgnoredByRules,
  isPathIgnoredByRuleSets,
  isWorkspacePathIgnored,
  loadAllWorkspaceIgnoreRuleSets,
  loadWorkspaceIgnore,
  readExcludesFileFromGitconfig,
  resolveGitExtraExcludeFilePaths,
} from './workspace-ignore.js';

describe('workspace-ignore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'gitconfig-empty-'));
    const configPath = join(configDir, 'gitconfig');
    await writeFile(configPath, '[core]\n');
    vi.stubEnv('GIT_CONFIG_GLOBAL', configPath);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('parses core.excludesfile from gitconfig', () => {
    expect(readExcludesFileFromGitconfig('[core]\n\texcludesfile = ~/.gitignore_global\n')).toMatch(
      /gitignore_global$/
    );
  });

  it('ignores paths from core.excludesFile absent from repo .gitignore', async () => {
    const home = await mkdtemp(join(tmpdir(), 'git-extra-home-'));
    const ignorePath = join(home, '.gitignore_global');
    const configPath = join(home, 'gitconfig');
    await writeFile(ignorePath, '**/.chatroom/downloads/\n');
    await writeFile(configPath, `[core]\n\texcludesfile = ${ignorePath}\n`);
    vi.stubEnv('GIT_CONFIG_GLOBAL', configPath);
    tmpDir = await mkdtemp(join(tmpdir(), 'workspace-global-'));
    await mkdir(join(tmpDir, '.chatroom', 'downloads', 'messages'), { recursive: true });
    await writeFile(join(tmpDir, '.gitignore'), '.chatroom/pi-sessions/\n');
    await writeFile(join(tmpDir, '.chatroom', 'downloads', 'messages', 'x.json'), '{}');
    expect(await isWorkspacePathIgnored(tmpDir, '.chatroom/downloads/messages/x.json')).toBe(true);
    expect(await isWorkspacePathIgnored(tmpDir, '.gitignore')).toBe(false);
  });

  it('prunes .git/info/exclude patterns', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'workspace-info-exclude-'));
    await mkdir(join(tmpDir, '.git', 'info'), { recursive: true });
    await mkdir(join(tmpDir, 'secret'));
    await writeFile(join(tmpDir, '.git', 'info', 'exclude'), 'secret/\n');
    await writeFile(join(tmpDir, 'secret', 'key.txt'), 'x');
    expect(await isWorkspacePathIgnored(tmpDir, 'secret/key.txt')).toBe(true);
    expect(
      (await resolveGitExtraExcludeFilePaths(tmpDir)).some((p) => p.includes('.git/info/exclude'))
    ).toBe(true);
  });

  it('lets local config override global config', async () => {
    const home = await mkdtemp(join(tmpdir(), 'git-extra-global-'));
    const globalIgnore = join(home, 'global.ignore');
    const localIgnore = join(home, 'local.ignore');
    const configPath = join(home, 'gitconfig');
    await writeFile(globalIgnore, 'global-only/\n');
    await writeFile(localIgnore, 'local-only/\n');
    await writeFile(configPath, `[core]\n\texcludesfile = ${globalIgnore}\n`);
    vi.stubEnv('GIT_CONFIG_GLOBAL', configPath);
    tmpDir = await mkdtemp(join(tmpdir(), 'workspace-local-config-'));
    await mkdir(join(tmpDir, '.git'), { recursive: true });
    await writeFile(join(tmpDir, '.git', 'config'), `[core]\n\texcludesfile = ${localIgnore}\n`);
    expect(await isWorkspacePathIgnored(tmpDir, 'local-only/a.txt')).toBe(true);
    expect(await isWorkspacePathIgnored(tmpDir, 'global-only/b.txt')).toBe(false);
  });

  it('excludes paths matched by .gitignore', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'workspace-ignore-'));
    await writeFile(join(tmpDir, '.gitignore'), 'node_modules/\nignored/\n');

    const ig = await loadWorkspaceIgnore(tmpDir);

    expect(isPathIgnoredByRules(ig, 'node_modules/foo/bar.js')).toBe(true);
    expect(isPathIgnoredByRules(ig, 'ignored/secret.txt')).toBe(true);
    expect(isPathIgnoredByRules(ig, 'src/index.ts')).toBe(false);
  });

  it('excludes paths matched by .cursorignore', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'workspace-ignore-cursor-'));
    await writeFile(join(tmpDir, '.cursorignore'), '.cursor/\n');

    const ig = await loadWorkspaceIgnore(tmpDir);

    expect(isPathIgnoredByRules(ig, '.cursor/rules.md')).toBe(true);
    expect(isPathIgnoredByRules(ig, 'src/app.ts')).toBe(false);
  });

  it('applies nested .gitignore rules relative to their directory', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'workspace-ignore-nested-'));
    await mkdir(join(tmpDir, 'packages', 'app'), { recursive: true });
    await writeFile(join(tmpDir, '.gitignore'), '*.log\n');
    await writeFile(join(tmpDir, 'packages', '.gitignore'), 'generated/\n!important.log\n');

    expect(await isWorkspacePathIgnored(tmpDir, 'root.log')).toBe(true);
    expect(await isWorkspacePathIgnored(tmpDir, 'packages/app/debug.log')).toBe(true);
    expect(await isWorkspacePathIgnored(tmpDir, 'packages/important.log')).toBe(false);
    expect(await isWorkspacePathIgnored(tmpDir, 'packages/generated/output.ts')).toBe(true);
  });

  it('loadAllWorkspaceIgnoreRuleSets collects nested rules without traversing ignored dirs', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'workspace-ignore-all-'));
    await mkdir(join(tmpDir, 'vendor', 'nested'), { recursive: true });
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, '.gitignore'), 'vendor/\n');

    const ruleSets = await loadAllWorkspaceIgnoreRuleSets(tmpDir);

    expect(ruleSets.length).toBeGreaterThan(0);
    expect(isPathIgnoredByRuleSets(ruleSets, 'vendor/nested/pkg.js')).toBe(true);
    expect(isPathIgnoredByRuleSets(ruleSets, 'src/index.ts')).toBe(false);
  });
});
