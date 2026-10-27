/**
 * Default deps for remove-image-background: real directory listing and the
 * full slicer adapter surface.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultRemoveImageBackgroundDeps } from './remove-image-background-deps.js';

vi.mock('@fal-ai/client', () => {
  throw new Error('must not load fal');
});

const SLICE_DEPS_KEYS = [
  'pathStatus',
  'statInput',
  'readFile',
  'readJsonIfExists',
  'decodePng',
  'encodePng',
  'ensureDir',
  'writeFile',
  'writeJson',
  'fileIdentity',
  'isSymlink',
  'now',
  'decoderVersion',
] as const;

describe('createDefaultRemoveImageBackgroundDeps', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chatroom-remove-bg-deps-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists directory entries', async () => {
    await writeFile(join(dir, 'a.png'), 'x');
    await writeFile(join(dir, 'notes.txt'), 'x');
    await mkdir(join(dir, 'folder'));
    const deps = createDefaultRemoveImageBackgroundDeps();

    const entries = await deps.listDir(dir);

    expect(entries.sort()).toEqual(['a.png', 'folder', 'notes.txt']);
  });

  it('includes every slicer dependency key', () => {
    const deps = createDefaultRemoveImageBackgroundDeps();

    for (const key of SLICE_DEPS_KEYS) expect(deps).toHaveProperty(key);
    expect(deps.decoderVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
