import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileCreate } from './useWorkspaceFileCreate';

const mockRequestFileWrite = vi.fn();
const mockWaitForFileWriteRequest = vi.fn();
const mockCompressGzip = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-create-test'],
  useSessionMutation: () => mockRequestFileWrite,
}));

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: vi.fn() }),
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

vi.mock('../utils/gzipContent', () => ({
  compressGzip: (...args: unknown[]) => mockCompressGzip(...args),
}));

describe('useWorkspaceFileCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompressGzip.mockResolvedValue({ compression: 'gzip', content: 'empty-gzip' });
    mockRequestFileWrite.mockResolvedValue({ requestId: 'req-create-1' });
    mockWaitForFileWriteRequest.mockResolvedValue(undefined);
  });

  it('calls requestFileWrite with create operation and empty gzip content', async () => {
    const { result } = renderHook(() =>
      useWorkspaceFileCreate({ machineId: 'machine-1', workingDir: '/workspace' })
    );

    await act(async () => {
      await result.current.createFile('docs/readme.md');
    });

    expect(mockCompressGzip).toHaveBeenCalledWith('');
    expect(mockRequestFileWrite).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
      filePath: 'docs/readme.md',
      operation: 'create',
      data: { compression: 'gzip', content: 'empty-gzip' },
    });
    expect(mockWaitForFileWriteRequest).toHaveBeenCalledOnce();
  });
});
