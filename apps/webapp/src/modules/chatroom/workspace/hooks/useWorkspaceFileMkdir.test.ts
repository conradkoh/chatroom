import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileMkdir } from './useWorkspaceFileMkdir';

const mockRequestFileWrite = vi.fn();
const mockConvexQuery = vi.fn();
const mockWaitForFileWriteRequest = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-mkdir-test'],
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

describe('useWorkspaceFileMkdir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestFileWrite.mockResolvedValue({ requestId: 'req-mkdir-1' });
    mockWaitForFileWriteRequest.mockResolvedValue(undefined);
  });

  it('requestMkdir calls requestFileWrite with operation mkdir', async () => {
    const { result } = renderHook(() =>
      useWorkspaceFileMkdir({ machineId: 'machine-1', workingDir: '/workspace' })
    );

    await act(async () => {
      await result.current.requestMkdir('docs');
    });

    expect(mockRequestFileWrite).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
      filePath: 'docs',
      operation: 'mkdir',
    });
    expect(mockWaitForFileWriteRequest).not.toHaveBeenCalled();
  });

  it('confirmMkdir polls until done', async () => {
    const { result } = renderHook(() =>
      useWorkspaceFileMkdir({ machineId: 'machine-1', workingDir: '/workspace' })
    );

    await act(async () => {
      await result.current.confirmMkdir('req-mkdir-1' as never);
    });

    expect(mockWaitForFileWriteRequest).toHaveBeenCalledOnce();
  });
});
