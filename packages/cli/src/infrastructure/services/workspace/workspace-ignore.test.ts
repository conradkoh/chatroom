import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isPathIgnoredByRules, loadWorkspaceIgnore } from './workspace-ignore.js';

describe('workspace-ignore', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
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
});
