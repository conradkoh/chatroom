import { ConvexError } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceFileTreeDeltaSend } from './workspace-file-tree-delta-send.js';
import type { DaemonSessionServiceShape } from '../../entry/daemon-services.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      applyFileTreeDeltaBatch: 'apply-delta',
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

describe('createWorkspaceFileTreeDeltaSend', () => {
  it('acknowledges a disabled sync error and invokes the shutdown callback', async () => {
    const mutation = vi.fn(async () => {
      throw new ConvexError({ code: 'FILE_TREE_SYNC_DISABLED', message: 'disabled' });
    });
    const onSyncDisabled = vi.fn();
    const send = createWorkspaceFileTreeDeltaSend(createSession(mutation), '/workspace', {
      onSyncDisabled,
    });

    const delta = {
      operationId: 'operation-1',
      added: [{ path: 'new.ts', type: 'file' as const }],
      removed: [],
      typeChanged: [],
      createdAt: 1,
    };

    await expect(send({ delta, baseRevision: 3 })).resolves.toEqual({
      status: 'applied',
      revision: 3,
    });
    expect(onSyncDisabled).toHaveBeenCalledOnce();
  });
});
