import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileDelete } from './useWorkspaceFileDelete';

const mockRequestFileWrite = vi.fn();
const mockConvexQuery = vi.fn();
const mockWaitForFileWriteRequest = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-delete-test'],
  useSessionMutation: () => mockRequestFileWrite,
}));

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mockConvexQuery }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      requestFileWrite: 'requestFileWrite',
      getFileWriteRequest: 'getFileWriteRequest',
    },
  },
}));

vi.mock('./fileWritePolling', () => ({
  waitForFileWriteRequest: (...args: unknown[]) => mockWaitForFileWriteRequest(...args),
}));

describe('useWorkspaceFileDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestFileWrite.mockResolvedValue({ requestId: 'req-delete-1' });
    mockWaitForFileWriteRequest.mockResolvedValue(undefined);
  });

  it('calls requestFileWrite with delete operation and polls to done', async () => {
    const { result } = renderHook(() =>
      useWorkspaceFileDelete({ machineId: 'machine-1', workingDir: '/workspace' })
    );

    await act(async () => {
      await result.current.deleteFile('docs/readme.md');
    });

    expect(mockRequestFileWrite).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
      filePath: 'docs/readme.md',
      operation: 'delete',
    });
    expect(mockWaitForFileWriteRequest).toHaveBeenCalledOnce();
  });
});
