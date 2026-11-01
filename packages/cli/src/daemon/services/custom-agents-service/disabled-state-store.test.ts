import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFileDisabledStateStore } from './disabled-state-store.js';
import { resolveCustomAgentDisabledStatePath } from '../../entry/custom-agent-state-path.js';

describe('createFileDisabledStateStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'custom-agents-state-'));
    filePath = join(dir, 'custom-agents-disabled.json');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('treats a missing file as an empty set', async () => {
    const store = createFileDisabledStateStore(filePath);

    await expect(store.read()).resolves.toEqual(new Set());
  });

  it('round-trips names', async () => {
    const store = createFileDisabledStateStore(filePath);

    await store.write(new Set(['alpha', 'beta']));

    expect([...(await store.read())].sort()).toEqual(['alpha', 'beta']);
    await expect(readFile(filePath, 'utf8')).resolves.toContain('"version": 1');
  });

  it('creates the parent directory when it is missing', async () => {
    const nested = join(dir, 'state', 'nested', 'custom-agents-disabled.json');
    const store = createFileDisabledStateStore(nested);

    await store.write(new Set(['alpha']));

    await expect(store.read()).resolves.toEqual(new Set(['alpha']));
  });

  it('writes the names in sorted order', async () => {
    const store = createFileDisabledStateStore(filePath);

    await store.write(new Set(['zeta', 'alpha']));

    const raw = await readFile(filePath, 'utf8');
    expect(raw.indexOf('alpha')).toBeLessThan(raw.indexOf('zeta'));
  });

  it('treats corrupt JSON as empty and logs once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(filePath, '{not json', 'utf8');
    const store = createFileDisabledStateStore(filePath);

    await expect(store.read()).resolves.toEqual(new Set());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('invalid JSON');
  });

  it('treats an unknown version as empty and logs once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(filePath, JSON.stringify({ version: 2, disabled: ['alpha'] }), 'utf8');
    const store = createFileDisabledStateStore(filePath);

    await expect(store.read()).resolves.toEqual(new Set());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops names the shared validator rejects', async () => {
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, disabled: ['alpha', 'Bad_Name', 'planner', 42] }),
      'utf8'
    );
    const store = createFileDisabledStateStore(filePath);

    await expect(store.read()).resolves.toEqual(new Set(['alpha']));
  });

  it('enforces the 256-entry cap on write', async () => {
    const store = createFileDisabledStateStore(filePath);
    const names = new Set(Array.from({ length: 257 }, (_, index) => `agent-${index}`));

    await expect(store.write(names)).rejects.toThrow(/max 256/);
    await expect(readFile(filePath, 'utf8')).rejects.toThrow();
  });

  it('accepts exactly 256 entries', async () => {
    const store = createFileDisabledStateStore(filePath);
    const names = new Set(Array.from({ length: 256 }, (_, index) => `agent-${index}`));

    await store.write(names);

    expect((await store.read()).size).toBe(256);
  });

  it('writes atomically, leaving no temp file behind', async () => {
    const store = createFileDisabledStateStore(filePath);

    await store.write(new Set(['alpha']));

    const entries = await readdir(dir);
    expect(entries).toEqual(['custom-agents-disabled.json']);
  });

  it('resolves the machine state path under the daemon directory', () => {
    const path = resolveCustomAgentDisabledStatePath('machine-1');

    expect(
      path.endsWith(join('.chatroom', 'daemon', 'machine-1', 'custom-agents-disabled.json'))
    ).toBe(true);
  });
});
