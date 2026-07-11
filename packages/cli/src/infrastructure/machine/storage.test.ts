import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetMachineConfigSaveChainForTests,
  ensureMachineRegistered,
  getMachineId,
  loadMachineConfig,
  saveMachineConfig,
} from './storage.js';
import type { MachineConfig } from './types.js';
import { MACHINE_CONFIG_VERSION } from './types.js';

vi.mock('../convex/client.js', () => ({
  getConvexUrl: vi.fn(() => 'https://unit-test.convex.cloud'),
}));

vi.mock('./detection.js', () => ({
  detectAvailableHarnesses: vi.fn(() => Promise.resolve([])),
  detectHarnessVersions: vi.fn(() => Promise.resolve({})),
}));

describe('ensureMachineRegistered', () => {
  let testHome: string;

  beforeEach(() => {
    testHome = join(
      tmpdir(),
      `chatroom-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testHome, { recursive: true });
    vi.stubEnv('HOME', testHome);
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('throws when no local config exists and allowCreate is not set', async () => {
    await expect(ensureMachineRegistered()).rejects.toThrow(/Machine not registered for endpoint/);
    await expect(ensureMachineRegistered({})).rejects.toThrow(/chatroom machine start/);
  });

  it('mints identity when allowCreate is true', async () => {
    const info = await ensureMachineRegistered({ allowCreate: true });
    expect(info.machineId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(await ensureMachineRegistered()).toEqual(
      expect.objectContaining({ machineId: info.machineId })
    );
  });

  it('refreshes harness metadata when config already exists (default allowCreate)', async () => {
    const chatroomDir = join(testHome, '.chatroom');
    mkdirSync(chatroomDir, { recursive: true });
    const machineId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    writeFileSync(
      join(chatroomDir, 'machine.json'),
      JSON.stringify(
        {
          version: MACHINE_CONFIG_VERSION,
          machines: {
            'https://unit-test.convex.cloud': {
              machineId,
              hostname: 'test-host',
              os: 'darwin',
              registeredAt: '2020-01-01T00:00:00.000Z',
              lastSyncedAt: '2020-01-01T00:00:00.000Z',
              availableHarnesses: [],
              harnessVersions: {},
            },
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    const info = await ensureMachineRegistered();
    expect(info.machineId).toBe(machineId);
    expect(Array.isArray(info.availableHarnesses)).toBe(true);
  });
});

describe('saveMachineConfig concurrency', () => {
  let testHome: string;

  beforeEach(() => {
    testHome = join(
      tmpdir(),
      `chatroom-storage-concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testHome, { recursive: true });
    vi.stubEnv('HOME', testHome);
  });

  afterEach(async () => {
    await _resetMachineConfigSaveChainForTests();
    rmSync(testHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('concurrent saveMachineConfig calls do not throw ENOENT on rename', async () => {
    const info = await ensureMachineRegistered({ allowCreate: true });
    const updates = Array.from({ length: 10 }, (_, i) =>
      saveMachineConfig({
        ...info,
        lastSyncedAt: new Date(Date.now() + i).toISOString(),
        availableHarnesses: info.availableHarnesses,
        harnessVersions: info.harnessVersions,
      } as MachineConfig)
    );
    await expect(Promise.all(updates)).resolves.toBeDefined();
    const final = await loadMachineConfig();
    expect(final?.machineId).toBe(info.machineId);
  });
});

describe('getMachineId', () => {
  let testHome: string;

  beforeEach(() => {
    testHome = join(tmpdir(), `chatroom-mid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testHome, { recursive: true });
    vi.stubEnv('HOME', testHome);
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('returns null when not registered (does not create config)', async () => {
    await expect(getMachineId()).resolves.toBeNull();
  });
});
