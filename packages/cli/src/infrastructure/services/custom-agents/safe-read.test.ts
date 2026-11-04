import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { safeReadTextFile } from './safe-read.js';

const KIB = 1024;

describe('safeReadTextFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'safe-read-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a regular UTF-8 file', async () => {
    const path = join(dir, 'file.txt');
    await writeFile(path, 'hello');

    await expect(safeReadTextFile(path, KIB)).resolves.toEqual({ ok: true, text: 'hello' });
  });

  it('strips a leading BOM and normalises CRLF to LF', async () => {
    const path = join(dir, 'bom.txt');
    await writeFile(path, '\uFEFFline one\r\nline two\r\n');

    await expect(safeReadTextFile(path, KIB)).resolves.toEqual({
      ok: true,
      text: 'line one\nline two\n',
    });
  });

  it('rejects a symlink without following it', async () => {
    const target = join(dir, 'target.txt');
    const link = join(dir, 'link.txt');
    await writeFile(target, 'hidden');
    await symlink(target, link);

    await expect(safeReadTextFile(link, KIB)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
      detail: 'symlink',
    });
  });

  it('rejects a directory as not regular', async () => {
    const path = join(dir, 'nested');
    await mkdir(path);

    await expect(safeReadTextFile(path, KIB)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
      detail: 'not-regular',
    });
  });

  it('reports a missing file by errno code only', async () => {
    await expect(safeReadTextFile(join(dir, 'missing.txt'), KIB)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
      detail: 'ENOENT',
    });
  });

  it('rejects invalid UTF-8 as an encoding failure', async () => {
    const path = join(dir, 'binary.txt');
    await writeFile(path, Buffer.from([0xff, 0xfe, 0xfd]));

    await expect(safeReadTextFile(path, KIB)).resolves.toEqual({
      ok: false,
      reason: 'unreadable',
      detail: 'encoding',
    });
  });

  it('accepts a file exactly at the cap', async () => {
    const path = join(dir, 'cap.txt');
    await writeFile(path, 'a'.repeat(KIB));

    const result = await safeReadTextFile(path, KIB);

    expect(result.ok).toBe(true);
  });

  it('rejects a file of cap + 1 bytes without decoding it', async () => {
    // The trailing 0xFF would fail UTF-8 decoding. Receiving `too-large` rather
    // than `encoding` proves the content past the cap is never decoded.
    const path = join(dir, 'over.txt');
    await writeFile(path, Buffer.concat([Buffer.from('a'.repeat(KIB)), Buffer.from([0xff])]));

    await expect(safeReadTextFile(path, KIB)).resolves.toEqual({
      ok: false,
      reason: 'too-large',
      detail: 'over.txt',
    });
  });

  it('rejects a 33 KiB file under a 32 KiB cap', async () => {
    const path = join(dir, 'AGENT.md');
    await writeFile(path, 'a'.repeat(33 * KIB));

    await expect(safeReadTextFile(path, 32 * KIB)).resolves.toEqual({
      ok: false,
      reason: 'too-large',
      detail: 'AGENT.md',
    });
  });
});
