// fallow-ignore-file complexity
import { describe, expect, it, vi } from 'vitest';

import { requestWorkspaceFileTree } from './request-workspace-file-tree';
import { FILE_TREE_SNAPSHOT_STALENESS_MS } from '../../constants/workspace-file-tree-watch';

function createMockCtx({
  v2Tree,
  manifestV3,
  existingRequest,
}: {
  v2Tree?: { scannedAt: number } | null | undefined;
  manifestV3?: { complete: boolean; scannedAt: number } | null | undefined;
  existingRequest?:
    | {
        _id: string;
        status: string;
        force?: boolean | undefined;
        updatedAt?: number | undefined;
      }
    | null
    | undefined;
} = {}) {
  const patch = vi.fn();
  const insert = vi.fn();

  const ctx = {
    db: {
      query: vi.fn((table: string) => {
        if (table === 'chatroom_workspaces') {
          return {
            withIndex: vi.fn(() => ({
              first: vi.fn(async () => ({ fileTreeSyncEnabled: true })),
            })),
          };
        }
        if (table === 'chatroom_workspaceFileTreeV2') {
          return {
            withIndex: vi.fn(() => ({
              first: vi.fn(async () => v2Tree ?? null),
            })),
          };
        }
        if (table === 'chatroom_workspaceFileTreeManifestV3') {
          return {
            withIndex: vi.fn(() => ({
              first: vi.fn(async () => manifestV3 ?? null),
            })),
          };
        }
        if (table === 'chatroom_workspaceFileTreeRequests') {
          return {
            withIndex: vi.fn(() => ({
              first: vi.fn(async () => existingRequest ?? null),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
      patch,
      insert,
    },
  };

  return { ctx: ctx as any, patch, insert };
}

describe('requestWorkspaceFileTree', () => {
  it('returns cached when V2 tree is fresh', async () => {
    const { ctx } = createMockCtx({
      v2Tree: { scannedAt: Date.now() },
    });

    const result = await requestWorkspaceFileTree(ctx, {
      machineId: 'm1',
      workingDir: '/repo',
    });

    expect(result).toEqual({ status: 'cached' });
  });

  it('patches updatedAt when force refresh hits an already-pending request', async () => {
    const { ctx, patch } = createMockCtx({
      existingRequest: {
        _id: 'req-1',
        status: 'pending',
        force: true,
        updatedAt: 1,
      },
    });

    const result = await requestWorkspaceFileTree(ctx, {
      machineId: 'm1',
      workingDir: '/repo',
      force: true,
    });

    expect(result).toEqual({ status: 'pending' });
    expect(patch).toHaveBeenCalledWith('chatroom_workspaceFileTreeRequests', 'req-1', {
      force: true,
      updatedAt: expect.any(Number),
    });
  });

  it('skips staleness check when force is true', async () => {
    const { ctx, insert } = createMockCtx({
      v2Tree: { scannedAt: Date.now() },
      manifestV3: { complete: true, scannedAt: Date.now() },
    });

    const result = await requestWorkspaceFileTree(ctx, {
      machineId: 'm1',
      workingDir: '/repo',
      force: true,
    });

    expect(result).toEqual({ status: 'requested' });
    expect(insert).toHaveBeenCalled();
  });

  it('returns cached from complete fresh V3 manifest', async () => {
    const { ctx } = createMockCtx({
      manifestV3: { complete: true, scannedAt: Date.now() },
    });

    const result = await requestWorkspaceFileTree(ctx, {
      machineId: 'm1',
      workingDir: '/repo',
    });

    expect(result).toEqual({ status: 'cached' });
  });

  it('does not return cached when V3 manifest is stale', async () => {
    const { ctx, insert } = createMockCtx({
      manifestV3: {
        complete: true,
        scannedAt: Date.now() - FILE_TREE_SNAPSHOT_STALENESS_MS - 1,
      },
    });

    const result = await requestWorkspaceFileTree(ctx, {
      machineId: 'm1',
      workingDir: '/repo',
    });

    expect(result).toEqual({ status: 'requested' });
    expect(insert).toHaveBeenCalled();
  });
});
