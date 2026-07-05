import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { listDirectory } from './dir-listing-scanner.js';

describe('listDirectory', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns only direct children and excludes secrets and node_modules', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'dir-list-'));
    await writeFile(join(tmpDir, 'readme.md'), '# hi');
    await mkdir(join(tmpDir, 'src'));
    await writeFile(join(tmpDir, 'src', 'app.ts'), 'app');
    await writeFile(join(tmpDir, '.env'), 'SECRET=1');
    await mkdir(join(tmpDir, 'node_modules'));
    await writeFile(join(tmpDir, 'node_modules', 'pkg.js'), 'x');

    const root = await listDirectory(tmpDir, '');
    const names = root.entries.map((e) => e.name);

    expect(names).toContain('readme.md');
    expect(names).toContain('src');
    expect(names).not.toContain('.env');
    expect(names).not.toContain('node_modules');

    const src = await listDirectory(tmpDir, 'src');
    expect(src.entries.map((e) => e.path)).toEqual(['src/app.ts']);
  });
});
