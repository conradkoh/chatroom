import { ConvexError } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceFileTreeCheckpointSend } from './workspace-file-tree-checkpoint-send.js';
import type { DaemonSessionServiceShape } from '../../entry/daemon-services.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      publishFileTreeCheckpoint: 'publish',
      syncFileTreeV2: 'sync-v2',
    },
  },
}));

function createSession(
  mutation: DaemonSessionServiceShape['backend']['mutation']
): DaemonSessionServiceShape {
  return {
    sessionId: 'session-1',
    machineId: 'machine-1',
    backend: { mutation, query: vi.fn() },
  } as unknown as DaemonSessionServiceShape;
}

describe('createWorkspaceFileTreeCheckpointSend', () => {
  it('loops publish until pruneComplete within one outbox delivery', async () => {
    let publishCalls = 0;
    const mutation = vi.fn(async (endpoint: string) => {
      if (endpoint === 'sync-v2') return undefined;
      if (endpoint === 'publish') {
        publishCalls += 1;
        return publishCalls === 1
          ? { status: 'published', revision: 7, prunedDeltaCount: 200, pruneComplete: false }
          : { status: 'unchanged', revision: 7, prunedDeltaCount: 12, pruneComplete: true };
      }
      throw new Error(`unexpected endpoint ${endpoint}`);
    });
    const send = createWorkspaceFileTreeCheckpointSend(createSession(mutation), '/workspace');
    const tree = {
      entries: [{ path: 'src/index.ts', type: 'file' as const }],
      rootDir: '/workspace',
      scannedAt: 1,
    };

    await expect(send({ tree, revision: 7 })).resolves.toEqual({ revision: 7 });
    expect(publishCalls).toBe(2);
  });

  it('acknowledges a disabled sync error and invokes the shutdown callback', async () => {
    const mutation = vi.fn(async (endpoint: string) => {
      if (endpoint === 'sync-v2') return undefined;
      throw new ConvexError({ code: 'FILE_TREE_SYNC_DISABLED', message: 'disabled' });
    });
    const onSyncDisabled = vi.fn();
    const send = createWorkspaceFileTreeCheckpointSend(createSession(mutation), '/workspace', {
      onSyncDisabled,
    });

    const tree = {
      entries: [{ path: 'src/index.ts', type: 'file' as const }],
      rootDir: '/workspace',
      scannedAt: 1,
    };

    await expect(send({ tree, revision: 7 })).resolves.toEqual({ revision: 7 });
    expect(onSyncDisabled).toHaveBeenCalledOnce();
  });
});
