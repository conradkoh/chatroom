import { describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceFileTreeCheckpointOutboxRegistry,
  type WorkspaceFileTreeCheckpointState,
} from './workspace-file-tree-checkpoint-outbox.js';

describe('workspace-file-tree-checkpoint-outbox', () => {
  it('preserves checkpoint state while delegating the send operation', async () => {
    const send = vi.fn(async (state: WorkspaceFileTreeCheckpointState) => ({
      revision: state.revision,
    }));
    const outbox = createWorkspaceFileTreeCheckpointOutboxRegistry('test-machine', () => send);
    const state: WorkspaceFileTreeCheckpointState = {
      tree: {
        entries: [{ path: 'src/index.ts', type: 'file' }],
        rootDir: '/workspace',
        scannedAt: 1,
      },
      revision: 7,
    };

    await expect(outbox.enqueue('/workspace', state)).resolves.toEqual({ revision: 7 });
    expect(send).toHaveBeenCalledWith(state);

    await outbox.stop('/workspace');
  });
});
