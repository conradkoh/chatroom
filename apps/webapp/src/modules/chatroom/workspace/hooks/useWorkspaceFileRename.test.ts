import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileRename } from './useWorkspaceFileRename';

const mockRequestFileWrite = vi.fn();
const mockConvexQuery = vi.fn();
const mockWaitForFileWriteRequest = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-rename-test'],
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

describe('useWorkspaceFileRename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestFileWrite.mockResolvedValue({ requestId: 'req-rename-1' });
    mockWaitForFileWriteRequest.mockResolvedValue(undefined);
  });

  it('requestRename calls requestFileWrite with rename operation and both paths', async () => {
    const { result } = renderHook(() =>
      useWorkspaceFileRename({ machineId: 'machine-1', workingDir: '/workspace' })
    );

    await act(async () => {
      await result.current.requestRename('src/old.ts', 'src/new.ts');
    });

    expect(mockRequestFileWrite).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
      filePath: 'src/old.ts',
      targetFilePath: 'src/new.ts',
      operation: 'rename',
    });
    expect(mockWaitForFileWriteRequest).not.toHaveBeenCalled();
  });

  it('confirmRename polls until done', async () => {
    const { result } = renderHook(() =>
      useWorkspaceFileRename({ machineId: 'machine-1', workingDir: '/workspace' })
    );

    await act(async () => {
      await result.current.confirmRename('req-rename-1' as never);
    });

    expect(mockWaitForFileWriteRequest).toHaveBeenCalledOnce();
  });
});
