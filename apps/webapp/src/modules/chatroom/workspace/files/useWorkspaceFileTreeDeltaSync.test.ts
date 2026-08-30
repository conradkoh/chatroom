import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileTreeDeltaSync } from './useWorkspaceFileTreeDeltaSync';
import { __resetWorkspaceFileTreeDeltaSyncCoordinatorForTests } from './workspaceFileTreeDeltaSyncCoordinator';
import { __resetWorkspaceFileTreeStoreForTests } from '../stores/workspaceFileTreeStore';

const mocks = vi.hoisted(() => ({
  useSessionQuery: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mocks.useSessionQuery(...args),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      getFileTreeDeltas: 'getFileTreeDeltas',
    },
  },
}));

vi.mock('./useRequestWorkspaceFileTree', () => ({
  useRequestWorkspaceFileTree: () => vi.fn(),
}));

vi.mock('../hooks/useWorkspaceFileTreeStoreRevision', () => ({
  useWorkspaceFileTreeStoreRevision: () => 100,
}));

const PROPS = {
  workspaceKey: 'machine-1::/workspace',
  machineId: 'machine-1',
  workingDir: '/workspace',
  enabled: true,
};

beforeEach(() => {
  mocks.useSessionQuery.mockReset();
  mocks.useSessionQuery.mockReturnValue(null);
  __resetWorkspaceFileTreeDeltaSyncCoordinatorForTests();
  __resetWorkspaceFileTreeStoreForTests();
});

describe('useWorkspaceFileTreeDeltaSync', () => {
  it('shares one active delta subscription and hands it off on owner unmount', async () => {
    const activeCalls = () =>
      mocks.useSessionQuery.mock.calls.filter(([, args]) => args !== 'skip');

    const first = renderHook(() => useWorkspaceFileTreeDeltaSync(PROPS));
    await waitFor(() => expect(activeCalls()).toHaveLength(1));

    const second = renderHook(() => useWorkspaceFileTreeDeltaSync(PROPS));
    await waitFor(() => expect(activeCalls()).toHaveLength(1));

    first.unmount();
    await waitFor(() => expect(activeCalls()).toHaveLength(2));

    second.unmount();
  });
});
