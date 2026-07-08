import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      getPendingFileContentRequests: 'mock-getPendingFileContentRequests',
      fulfillFileContentV2: 'mock-fulfillFileContentV2',
    },
  },
}));

async function runFulfillment(deps: ReturnType<typeof createMockDaemonDeps>, workingDir: string) {
  const { fulfillFileContentRequestsEffect } = await import('./file-content-fulfillment.js');
  const layer = daemonSessionToLayers(
    createMockDaemonSessionInit({
      backend: deps.backend,
      workspaceListStore: {
        workspaces: [{ workingDir }],
        updatedAt: Date.now(),
      },
    })
  );
  await Effect.runPromise(fulfillFileContentRequestsEffect.pipe(Effect.provide(layer)));
}

describe('fulfillFileContentRequestsEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('defers fulfillment when the file is not on disk yet (ENOENT)', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'chatroom-file-content-'));
    try {
      const deps = createMockDaemonDeps();
      vi.mocked(deps.backend.query).mockResolvedValue([
        { _id: 'req-1', workingDir, filePath: 'notes.md' },
      ]);

      await runFulfillment(deps, workingDir);

      expect(deps.backend.mutation).not.toHaveBeenCalled();
    } finally {
      await rm(workingDir, { recursive: true, force: true });
    }
  });

  it('fulfills content when request workingDir differs only by trailing slash', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'chatroom-file-content-'));
    try {
      await writeFile(join(workingDir, 'README.md'), '# Title');
      const deps = createMockDaemonDeps();
      vi.mocked(deps.backend.query).mockResolvedValue([
        { _id: 'req-1', workingDir: `${workingDir}/`, filePath: 'README.md' },
      ]);

      await runFulfillment(deps, workingDir);

      expect(deps.backend.mutation).toHaveBeenCalledWith(
        'mock-fulfillFileContentV2',
        expect.objectContaining({
          workingDir: `${workingDir}/`,
          filePath: 'README.md',
          encoding: 'utf8',
        })
      );
    } finally {
      await rm(workingDir, { recursive: true, force: true });
    }
  });

  it('fulfills empty content when the file exists', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'chatroom-file-content-'));
    try {
      await writeFile(join(workingDir, 'notes.md'), '');
      const deps = createMockDaemonDeps();
      vi.mocked(deps.backend.query).mockResolvedValue([
        { _id: 'req-1', workingDir, filePath: 'notes.md' },
      ]);

      await runFulfillment(deps, workingDir);

      expect(deps.backend.mutation).toHaveBeenCalledWith(
        'mock-fulfillFileContentV2',
        expect.objectContaining({
          filePath: 'notes.md',
          encoding: 'utf8',
          truncated: false,
        })
      );
    } finally {
      await rm(workingDir, { recursive: true, force: true });
    }
  });
});
