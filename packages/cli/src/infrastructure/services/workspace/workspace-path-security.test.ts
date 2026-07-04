import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  gunzipBase64Payload,
  isPathInsideRoot,
  resolvePathWithinWorkspace,
  validateRelativePathSegments,
} from './workspace-path-security.js';

describe('isPathInsideRoot', () => {
  it('rejects prefix trap without path traversal', () => {
    expect(isPathInsideRoot('/tmp/foo', '/tmp/foobar')).toBe(false);
  });

  it('accepts paths inside the root', () => {
    expect(isPathInsideRoot('/tmp/foo', '/tmp/foo/bar')).toBe(true);
  });
});

describe('validateRelativePathSegments', () => {
  it('rejects null bytes', () => {
    expect(validateRelativePathSegments('notes\0.md')).toEqual({
      ok: false,
      error: 'Invalid file path',
    });
  });
});

describe('gunzipBase64Payload', () => {
  it('rejects gzip bomb output beyond maxBytes', () => {
    const bomb = gzipSync(Buffer.alloc(1024 * 1024, 'x'));
    const base64 = bomb.toString('base64');
    const result = gunzipBase64Payload(base64, 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toBe('File content too large');
    }
  });
});

describe('resolvePathWithinWorkspace', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('rejects symlink pointing outside workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'chatroom-ws-'));
    const outside = await mkdtemp(join(tmpdir(), 'chatroom-out-'));
    dirs.push(workspace, outside);

    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(workspace, 'escape'));

    const root = await realpath(workspace);
    const result = await resolvePathWithinWorkspace(root, 'escape/secret.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Path escapes workspace');
    }
  });
});
